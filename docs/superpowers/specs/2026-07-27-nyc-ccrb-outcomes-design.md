# NYC CCRB structured outcomes — design

## Problem

No ingestion pipeline or the review-queue approval flow (`apps/api-internal/src/routes/reviewQueue.ts`'s `promoteReviewQueueItem`) ever creates an `outcomes` row today, regardless of source — confirmed by grep: zero references to `outcomes`/`outcome` in that file. For NYC CCRB specifically, real disciplinary-outcome data is being wasted: `client.ts` already fetches `nypd_allegation_disposition` (NYPD's actual disciplinary action, e.g. `"Command Discipline - A"`) onto `NycCcrbAllegation.nypdDisposition`, but `run.ts` never reads that field at all. `ccrb_allegation_disposition` (CCRB's own finding on whether the complaint had merit, e.g. `"Substantiated (Charges)"`) is used, but only as free text folded into `shortDescription` — never captured as structured data.

The `outcomes` table (migration 0008) already has a real schema for exactly this (`outcome_type` enum, `date`, `amount_cents`, `details`), and `record_revisions.record_type` already includes `'outcome'` as a valid value (migration 0011) — this data path was clearly anticipated when the schema was designed, just never wired up. A manual `POST /api/internal/outcomes` route already exists (`apps/api-internal/src/routes/outcomes.ts`) for a reviewer to create one by hand; this design adds an *automated* path from NYC CCRB's own disposition data.

## 1. Which field drives the mapping, and why

`nypd_disposition` only — not `ccrb_disposition`. The `outcomes` table is about what happened *as a result* (discipline, termination, no action) — that's what NYPD's own department disposition records. `ccrb_disposition` is CCRB's finding on the complaint's merit (substantiated/unfounded/etc.), a different question; it keeps its existing role as descriptive text in `shortDescription`, unchanged.

## 2. The disposition → outcome_type mapping (conservative, human-approved)

Live-verified against the real Socrata Allegations dataset (`6xgr-kwjq`, `$select nypd_allegation_disposition, count(*) group by ...`): **60 distinct real values**. Most don't map cleanly onto the 7-value `outcome_type` enum — four of those seven (`DA_declination`, `lawsuit_settlement`, `lawsuit_dismissed`, `criminal_charges_officer`) belong to a civil-suit/prosecution track CCRB disciplinary data doesn't cover at all, so only `internal_discipline`, `termination`, and `no_action` are ever reachable from this source.

Per the approved conservative scope: **only an unambiguous string gets mapped; everything else is left out of structured `outcomes` entirely** (the raw disposition string stays visible in the incident's own data — see §4 below — nothing is lost, it's just not double-encoded as structured data when confidence is low).

```typescript
// apps/ingestion/src/nyc-ccrb/disposition.ts
const TERMINATION_DISPOSITIONS = new Set(["APU Closed: Terminated"]);

const INTERNAL_DISCIPLINE_DISPOSITIONS = new Set([
  "Command Discipline - A",
  "Command Discipline - B",
  "APU Command Discipline A",
  "APU Command Discipline B",
  "APU Command Discipline",
  "Instructions",
  "APU Instructions",
  "Command Level Instructions",
  "Formalized Training",
  "APU Formalized Training",
  "APU Closed: Retained, with discipline",
  "APU Retained, with discipline",
  // Judgment call, human-approved: the dataset separately and explicitly
  // labels "APU Closed: Terminated" as its own distinct value, which
  // implies termination is never silently folded into generic "with
  // discipline" phrasing elsewhere -- so "with discipline" (no explicit
  // "terminated") is treated as excluding termination.
  "APU Closed: Previously adjudicated, with discipline",
  "APU Previously adjudicated, with discipline",
]);

const NO_ACTION_DISPOSITIONS = new Set([
  "No Disciplinary Action-DUP",
  "No Disciplinary Action-SOL",
  "APU Not guilty",
  "Not Guilty - DCT",
  "Not Guilty - OATH",
  "APU Not guilty after trial-PC Approved",
  "APU Dismissed",
  "APU Closed: Dismissed by APU",
  "Charge Dismissed - DCT",
  "Charge Dismissed - OATH",
  "APU Closed: Charges not served",
  "APU Charges not served",
  "APU Closed: Retained, without discipline",
  "APU Closed: Previously adjudicated, without discipline",
  "APU Retained, without discipline",
  "APU Closed: SOL Expired prior to APU",
  "APU Closed: SOL Expired in APU",
]);

/** Maps NYC CCRB's real nypd_allegation_disposition strings to this
 * schema's OutcomeType, conservatively -- see design doc for the full
 * human-reviewed rationale. Returns null for anything ambiguous (bare
 * "Guilty"/plea/negotiated dispositions that don't state the resulting
 * sanction, so severity can't be determined) or non-disciplinary
 * (pending/in-process/retired/resigned/deceased/no-finding/other) --
 * intentionally NOT an exhaustive mapping of all 60 real values. */
export function mapNypdDispositionToOutcomeType(disposition: string | null): OutcomeType | null {
  if (!disposition) return null;
  if (TERMINATION_DISPOSITIONS.has(disposition)) return "termination";
  if (INTERNAL_DISCIPLINE_DISPOSITIONS.has(disposition)) return "internal_discipline";
  if (NO_ACTION_DISPOSITIONS.has(disposition)) return "no_action";
  return null;
}
```

(`OutcomeType` imported from `@cop/shared-types`, already defined there — no new type needed.)

## 3. Proposal shape: bundled into `IncidentCandidateProposal`, not a separate review item

Confirmed with the user: a proposed outcome rides alongside the incident candidate as one optional field, approved/rejected together in one reviewer action — not a standalone `OutcomeCandidateProposal` review-queue item type. This fits CCRB's actual data shape (disposition arrives together with the incident report in the same allegation row) and avoids a reviewer having to review the same complaint twice. It deliberately does **not** support the different case of an outcome disclosed later against an *already-approved* incident (e.g. a lawsuit settlement reported months afterward) — no source in this codebase populates that today either (CourtListener doesn't touch `outcomes` at all currently), so this is a real, separate future capability, not a regression.

No reviewer edit/skip control for the proposed outcome in v1 (confirmed with the user) — it's shown as part of the review-queue item (never silently created) and created automatically alongside the incident when approved. Disagreeing with it means rejecting/editing the whole item, same as any other proposed field today.

## 4. Data plumbing: `closeDate` needs surfacing too

The outcome's `date` should be when NYPD's disciplinary action was decided, not when the alleged incident occurred (`incidentDate`, already used for the incident itself) — CCRB's `close_date` field (live-verified real field on the Complaints dataset, e.g. `"2011-06-01T18:11:15.000"`) is the best available real date for this. It's currently used only as the pipeline's windowing filter (`fetchClosedComplaints`'s `$where close_date >= ...`), never stored per-row or surfaced past that function.

**`apps/ingestion/src/nyc-ccrb/client.ts` changes:**
- `RawComplaintRow` gains `close_date?: string`.
- `fetchClosedComplaints`'s `$select` param changes from `"complaint_id,incident_date"` to `"complaint_id,incident_date,close_date"` (Socrata only returns selected fields — a real, easy-to-miss requirement).
- `fetchClosedComplaints`'s return type changes from `Map<string, string | null>` (incident date only) to `Map<string, { incidentDate: string | null; closeDate: string | null }>`, storing `row.close_date?.slice(0, 10) ?? null` (truncated to `YYYY-MM-DD`, matching how `sinceDate` itself is already computed a few lines up, and matching `outcomes.date`'s plain `date` column type — the raw field includes a time component the `date` column doesn't need).
- `normalizeAllegation` reads both fields from that map instead of the current bare string, populating a new `closeDate: string | null` field on `NycCcrbAllegation` (in addition to the existing `incidentDate`).
- `NycCcrbAllegation` gains `closeDate: string | null`.

Every complaint this pipeline ever fetches is already filtered to be closed (`fetchClosedComplaints`'s whole purpose), so `close_date` is expected to be present in practice for every row processed — but the type stays nullable, matching this codebase's existing defensive-parsing convention throughout `client.ts`, with the outcome simply getting `date: null` in the rare case it's genuinely absent (never falling back to `incidentDate` — that would conflate two different dates).

## 5. Generic plumbing: `CandidateItem` → `IncidentCandidateProposal`

`proposedOutcome` is a generic, pipeline-agnostic field — `OutcomeType` itself isn't CCRB-specific, and a future pipeline could populate it the same way:

- `packages/ingestion-lib/src/types.ts`'s `CandidateItem` gains:
  ```typescript
  proposedOutcome?: { outcomeType: OutcomeType; date?: string; details?: string };
  ```
- `packages/shared-types/src/index.ts`'s `IncidentCandidateProposal` gains the identical field.
- `packages/ingestion-lib/src/queue.ts`'s `buildProposal` passes `item.proposedOutcome` through unchanged into the `IncidentCandidateProposal` it constructs — no new logic, just one more field carried through.

## 6. NYC CCRB pipeline builds the proposal

**`apps/ingestion/src/nyc-ccrb/run.ts`**, in the per-allegation loop, after building the existing `item` object: if `mapNypdDispositionToOutcomeType(allegation.nypdDisposition)` returns non-null, set:

```typescript
proposedOutcome: {
  outcomeType: mappedType,
  date: allegation.closeDate ?? undefined,
  details: allegation.nypdDisposition ?? undefined, // preserves the exact raw source string even though it's mapped to a coarser enum
}
```

Otherwise `proposedOutcome` stays `undefined` — no field, not a null placeholder, matching every other optional field's convention on `CandidateItem` already.

## 7. Approval creates the outcome atomically with the incident

**`apps/api-internal/src/routes/reviewQueue.ts`'s `promoteReviewQueueItem`**, in the `else if (proposed.type === "incident_candidate")` branch, right after the existing `incident_officers` INSERT and its `record_revisions` write: if `(proposed as IncidentCandidateProposal).proposedOutcome` is present, insert the outcome in the same transaction (this function already runs inside the caller's `BEGIN`/`COMMIT`), mirroring the exact insert/revision shape already used by the existing manual `POST /api/internal/outcomes` route (`apps/api-internal/src/routes/outcomes.ts:82-111`) — same columns, same `writeRecordRevision` call shape, `changedBy: reviewerId` (a human is approving this, unlike the officer-bulk-import's `changed_by: NULL` pipeline-authored case):

```typescript
const proposedOutcome = (proposed as IncidentCandidateProposal).proposedOutcome;
if (proposedOutcome) {
  const outcomeResult = await client.query<{ id: string }>(
    `INSERT INTO outcomes (incident_id, outcome_type, date, details)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [incidentId, proposedOutcome.outcomeType, proposedOutcome.date ?? null, proposedOutcome.details ?? null],
  );
  await writeRecordRevision(client, {
    recordType: "outcome",
    recordId: outcomeResult.rows[0].id,
    changeType: "create",
    diff: { incidentId, outcomeType: proposedOutcome.outcomeType, date: proposedOutcome.date ?? null, details: proposedOutcome.details ?? null },
    changedBy: reviewerId,
  });
}
```

This applies to both `POST /:id/approve` and `POST /bulk-approve` automatically, since both already share `promoteReviewQueueItem` — no separate wiring needed for bulk-approve.

## 8. Admin UI: the reviewer must see the proposed outcome before approving

**`apps/admin/src/components/ReviewQueueItemCard.tsx`'s `renderDetails`**, in the `incident_candidate` branch, add a conditional block (same pattern as the existing `externalUrl`/`note` conditional blocks) right before the closing `</dl>`:

```tsx
{rec.proposedOutcome && (
  <>
    <dt>Proposed outcome</dt>
    <dd>
      {rec.proposedOutcome.outcomeType.replace(/_/g, " ")}
      {rec.proposedOutcome.date ? ` — ${formatDate(rec.proposedOutcome.date)}` : ""}
      {rec.proposedOutcome.details ? ` (${rec.proposedOutcome.details})` : ""}
    </dd>
  </>
)}
```

This is the only UI change in scope — no edit control, per §3.

## 9. Backfilling the existing 2,231-item backlog

Confirmed with the user: yes, extend the existing `apps/ingestion/src/nyc-ccrb/backfillReviewQueue.ts` (from the prior officer-bulk-import feature) to also compute and merge in `proposedOutcome`, rather than writing a new script that re-fetches and re-loops over the same ~8,185 allegations a second time. This script's job was already "make `review_queue` rows as resolved as current data allows" — outcome resolution is a natural extension of that same job, not a new one.

**Important correctness point:** officer resolution and outcome resolution are independent — a row must be able to gain a `proposedOutcome` even when its officer still doesn't resolve, and vice versa. The current script's `if (!officerId) { continue; }` skips the *entire* row when no officer resolves, which would wrongly also skip adding a perfectly-good `proposedOutcome` to that same row. This needs restructuring: compute both independently, skip the row only if *neither* applies, and build the `proposed_record` JSON patch to include only whichever of the two actually resolved (officer, outcome, or both) — never strip `officerName` unless `officerId` is actually being set this pass, and only bump `match_confidence` to `'high'` when `officerId` is newly resolved (outcome resolution alone says nothing about officer-match confidence).

```typescript
for (const allegation of allegations) {
  const externalRef = `${allegation.complaintId}:${allegation.allegationRecordIdentity}`;

  let officerId: string | undefined;
  if (allegation.taxId) {
    const officerResult = await pool.query<{ id: string }>(
      `SELECT id FROM officers WHERE external_officer_ref = $1`,
      [`nyc_ccrb:${allegation.taxId}`],
    );
    officerId = officerResult.rows[0]?.id;
  }

  const outcomeType = mapNypdDispositionToOutcomeType(allegation.nypdDisposition);
  const proposedOutcome = outcomeType
    ? { outcomeType, date: allegation.closeDate ?? undefined, details: allegation.nypdDisposition ?? undefined }
    : undefined;

  if (!officerId && !proposedOutcome) {
    continue; // nothing new resolves for this allegation
  }

  let patch = "proposed_record";
  const params: unknown[] = [];
  if (officerId) {
    params.push(officerId);
    patch = `(${patch} - 'officerName') || jsonb_build_object('officerId', $${params.length}::text)`;
  }
  if (proposedOutcome) {
    params.push(JSON.stringify(proposedOutcome));
    patch = `${patch} || jsonb_build_object('proposedOutcome', $${params.length}::jsonb)`;
  }
  const confidenceClause = officerId ? `, match_confidence = 'high'` : "";
  params.push(externalRef);

  const result = await pool.query(
    `UPDATE review_queue
        SET proposed_record = ${patch}${confidenceClause}
      WHERE status = 'pending'
        AND source_id = (SELECT id FROM sources WHERE external_ref = $${params.length} AND source_type = 'official_dataset')`,
    params,
  );
  updated += result.rowCount ?? 0;
}
```

Re-running this modified script in production (it already ran once for the officer-only case) is safe: `status` stays `'pending'` on every row it touches until a human actually approves it, so a fresh run reaches the same rows again and can add `proposedOutcome` to ones that were already officer-resolved by the first run, without disturbing their already-correct `officerId`.

## Out of scope

- An outcome arriving later against an already-approved, pre-existing incident (e.g. a lawsuit settlement disclosed months after the fact). No source populates `outcomes` today, so this isn't a regression — a real future capability if a source ever needs it (most likely CourtListener, if it's ever enabled for real).
- Reviewer edit/skip control for the proposed outcome independent of the incident (§3) — confirmed acceptable for v1 given the mapping is already conservative.
- `citations` rows linking the new `outcomes` row (or the sibling `incidents` row) back to its originating `sources` row. Noticed while researching this design: `promoteReviewQueueItem` doesn't create a `citations` row for the *incident* either today, even though `review_queue.source_id` is right there — a pre-existing gap in the whole review-queue → public-tables pipeline, not something introduced or worsened by this feature. Worth a dedicated future pass across both `incidents` and `outcomes` together, not a one-off special case for outcomes alone.
- `amount_cents`/`currency` on the created outcome — CCRB disciplinary data never carries a dollar figure (that's `lawsuit_settlement`'s domain, not reachable from this mapping per §2) — left `null`/default exactly as the manual creation route already defaults them.
