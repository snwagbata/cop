# Officer detail page + editing — design

## Problem

Prompted by designing an officer-duplicate-merge feature: a merge UI needs
a real side-by-side comparison of two officer records, and no such view
exists. Surveying the admin app found a bigger gap than just "no compare
view" — there is **no officer detail page or edit capability of any kind**
in `apps/admin` today:

- `apps/api-internal/src/routes/officers.ts` has exactly four routes:
  `GET /search` (name/badge lookup, narrow fields), `POST /` (create),
  `GET /pending-photos`, `POST /:id/confirm-photo` /
  `POST /:id/reject-photo`. No `GET /:id`, no `PATCH`/`PUT` anywhere.
- `apps/admin`'s 9 pages have nothing officer-specific beyond the
  photo-review queue (only officers with an unconfirmed photo) and the
  officer-creation form embedded in `NewRecordPage`.
- The only place an officer's raw UUID surfaces in the admin UI at all is
  incidental plain text inside `ReviewQueueItemCard.tsx`
  (`` `officer ${rec.officerId}` ``) — not a labeled field, not a link
  anywhere.
- `packages/shared-types`' public-facing `OfficerDetail` (used by
  `apps/web`) doesn't carry `postCertificationId` or `hireDate` at all —
  so it can't be reused as-is for an internal admin view; a new internal
  type is needed.

This spec builds the detail page and editing as one cohesive piece (editing
needs a detail page to edit from), which the future merge spec will then
build on top of. Merge itself is explicitly out of scope here.

## 1. `GET /api/internal/officers/:id` — new endpoint

Follows `officers.ts`'s existing conventions exactly (`UUID_RE` validation,
`asyncHandler`, `ApiError`, `mapDepartmentRow`):

```ts
officersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      throw new ApiError(400, "invalid_request", "officer id must be a valid UUID.");
    }

    const officerResult = await pool.query<OfficerDetailRow>(
      `SELECT o.id, o.first_name, o.last_name, o.known_aliases, o.department_id, d.name AS department_name,
              o.badge_number, o.rank, o.hire_date, o.employment_status, o.post_certification_id,
              o.photo_url, o.photo_confirmed, o.created_at
         FROM officers o
         JOIN departments d ON d.id = o.department_id
        WHERE o.id = $1`,
      [id],
    );
    const row = officerResult.rows[0];
    if (!row) {
      throw new ApiError(404, "not_found", `No officer with id ${id}.`);
    }

    const historyResult = await pool.query<OfficerHistoryRow>(
      `SELECT h.department_id, d.name AS department_name, h.badge_number, h.start_date, h.end_date, h.separation_reason
         FROM officer_department_history h
         JOIN departments d ON d.id = h.department_id
        WHERE h.officer_id = $1
        ORDER BY h.start_date DESC`,
      [id],
    );

    const countsResult = await pool.query<{ incident_count: string; outcome_count: string }>(
      `SELECT
         (SELECT count(*) FROM incident_officers WHERE officer_id = $1) AS incident_count,
         (SELECT count(*) FROM outcomes ou JOIN incident_officers io ON io.incident_id = ou.incident_id
           WHERE io.officer_id = $1) AS outcome_count`,
      [id],
    );

    const response: InternalOfficerDetail = {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      knownAliases: row.known_aliases,
      departmentId: row.department_id,
      departmentName: row.department_name,
      badgeNumber: row.badge_number,
      rank: row.rank,
      hireDate: row.hire_date,
      employmentStatus: row.employment_status,
      postCertificationId: row.post_certification_id,
      photoUrl: row.photo_url,
      photoConfirmed: row.photo_confirmed,
      createdAt: row.created_at,
      departmentHistory: historyResult.rows.map((h) => ({
        departmentId: h.department_id,
        departmentName: h.department_name,
        badgeNumber: h.badge_number,
        startDate: h.start_date,
        endDate: h.end_date,
        separationReason: h.separation_reason,
      })),
      incidentCount: Number(countsResult.rows[0].incident_count),
      outcomeCount: Number(countsResult.rows[0].outcome_count),
    };
    res.status(200).json(response);
  }),
);
```

**New type**, `packages/shared-types` — `InternalOfficerDetail`, deliberately
separate from the public `OfficerDetail` (different audience, different
fields — `postCertificationId`/`hireDate`/`photoConfirmed` are internal-only,
and this returns lightweight counts instead of full nested `Incident[]`/
`resolvedDisputes[]`, since a reviewer clicking into individual incidents
already has the review-queue/audit-log flows for that):

```ts
export interface InternalOfficerDetail {
  id: string;
  firstName: string;
  lastName: string;
  knownAliases: string[];
  departmentId: string;
  departmentName: string;
  badgeNumber: string | null;
  rank: string | null;
  hireDate: string | null;
  employmentStatus: EmploymentStatus;
  postCertificationId: string | null;
  photoUrl: string | null;
  photoConfirmed: boolean;
  createdAt: string;
  departmentHistory: OfficerDepartmentHistoryEntry[];
  incidentCount: number;
  outcomeCount: number;
}
```

(Reuses the existing `OfficerDepartmentHistoryEntry` shape as-is — no new
type needed there.)

## 2. `PATCH /api/internal/officers/:id` — new endpoint

Editable fields, matching `CreateOfficerRequest`'s field set minus
`departmentId` (see §3 for why department is excluded): `firstName`,
`lastName`, `knownAliases`, `badgeNumber`, `rank`, `employmentStatus`,
`postCertificationId`, `photoUrl`. All optional/partial — only supplied
fields are updated (a real `PATCH`, not a full replace).

```ts
officersRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const reviewer = req.reviewer!;
    if (!UUID_RE.test(id)) {
      throw new ApiError(400, "invalid_request", "officer id must be a valid UUID.");
    }
    const body = (req.body ?? {}) as Partial<UpdateOfficerRequest>;

    if ("employmentStatus" in body && !VALID_EMPLOYMENT_STATUSES.includes(body.employmentStatus!)) {
      throw new ApiError(400, "invalid_request", `employmentStatus must be one of ${VALID_EMPLOYMENT_STATUSES.join(", ")}.`);
    }
    if ("firstName" in body && !body.firstName?.trim()) {
      throw new ApiError(400, "invalid_request", "firstName cannot be blank.");
    }
    if ("lastName" in body && !body.lastName?.trim()) {
      throw new ApiError(400, "invalid_request", "lastName cannot be blank.");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query<{ id: string; photo_url: string | null }>(
        `SELECT id, photo_url FROM officers WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!existing.rows[0]) {
        throw new ApiError(404, "not_found", `No officer with id ${id}.`);
      }
      const photoUrlChanged = "photoUrl" in body && body.photoUrl !== existing.rows[0].photo_url;

      // Build SET clause dynamically from only the fields actually present
      // in the request body -- a real partial update, not a full replace
      // that would silently null out omitted fields.
      const setClauses: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;
      const fieldMap: Record<string, string> = {
        firstName: "first_name",
        lastName: "last_name",
        knownAliases: "known_aliases",
        badgeNumber: "badge_number",
        rank: "rank",
        employmentStatus: "employment_status",
        postCertificationId: "post_certification_id",
        photoUrl: "photo_url",
      };
      for (const [key, column] of Object.entries(fieldMap)) {
        if (key in body) {
          setClauses.push(`${column} = $${paramIndex}`);
          values.push((body as Record<string, unknown>)[key]);
          paramIndex++;
        }
      }
      // photoUrl changing resets the confirmation gate (DESIGN.md §7) --
      // migration 0017's own comment flags this as required for whenever
      // an edit endpoint eventually existed.
      if (photoUrlChanged) {
        setClauses.push("photo_confirmed = false", "photo_confirmed_by = NULL", "photo_confirmed_at = NULL");
      }
      if (setClauses.length === 0) {
        throw new ApiError(400, "invalid_request", "No editable fields provided.");
      }

      values.push(id);
      await client.query(`UPDATE officers SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`, values);

      await writeRecordRevision(client, {
        recordType: "officer",
        recordId: id,
        changeType: "update",
        diff: body,
        changedBy: reviewer.id,
      });

      await client.query("COMMIT");
      res.status(200).json({ ok: true });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);
```

**New type**, `packages/shared-types` — `UpdateOfficerRequest`: same fields
as `CreateOfficerRequest` minus `departmentId`/`hireDate` (hire date is
also excluded from editing — it's a historical fact tied to the *original*
hire, not something that should drift via a general edit form; if it was
wrong at creation, that's a data-quality fix best done directly, not a
day-to-day edit action), all optional:

```ts
export interface UpdateOfficerRequest {
  firstName?: string;
  lastName?: string;
  knownAliases?: string[];
  badgeNumber?: string | null;
  rank?: string | null;
  employmentStatus?: EmploymentStatus;
  postCertificationId?: string | null;
  photoUrl?: string | null;
}
```

## 3. `departmentId` is deliberately not editable here

Changing an officer's department is not a simple field edit — it needs a
new `officer_department_history` row (closing out the old one with an
`end_date`, opening a new one), which is the "transfer officer" feature
already identified as a separate, not-yet-built piece of work. Allowing a
direct `departmentId` edit through this generic endpoint would silently
update `officers.department_id` with no history row at all — recreating
the exact desync problem that motivated looking at this whole area in the
first place (nothing today keeps `officers.department_id` in sync with
`officer_department_history`, and no code path writes to that table).
Department changes stay out of scope until the transfer feature exists.

## 4. Response type / permissions

Both endpoints use the exact same permission level as `POST /` (officer
creation) and the confirm/reject-photo routes: any authenticated reviewer,
no admin gating. This is a data-entry/correction action at the same trust
level as creating an officer in the first place — the admin-only bar is
reserved for genuinely consolidating/destructive actions (the future merge
feature), not routine edits.

## 5. Admin UI

- **`apps/admin/src/pages/OfficerDetailPage.tsx`** (new), route
  `/officers/:id`. Fetches `GET /api/internal/officers/:id`, renders every
  `InternalOfficerDetail` field read-only by default, plus the department
  history list and incident/outcome counts (each count links to the
  existing audit-log/review-queue views filtered to that officer, rather
  than duplicating incident detail rendering here — YAGNI: those views
  already exist).
- **Edit mode**: a toggle on the same page (not a separate route) reusing
  the same field set/validation as `NewOfficerForm.tsx`'s create form,
  submitting via `PATCH`. `departmentId` is rendered read-only with a note
  ("transfer officer" — coming later) rather than omitted entirely, so a
  reviewer isn't left wondering why it's missing.
- **Getting to the page**: `OfficerSearchPicker`'s existing dropdown
  results become links to `/officers/:id` (currently rendered as
  plain non-interactive text) — the cheapest way to make officers
  discoverable, since a dedicated roster-browse/list page isn't needed yet
  (search-to-detail covers the actual reviewer workflow; a browse-everything
  list is easy to add later if it turns out to be needed, but nothing today
  suggests reviewers need to page through the entire roster without a
  search term in mind).

## Out of scope

- Officer merge (separate, future spec — this is its prerequisite).
- Officer transfer / department change (separate, future spec — §3 above).
- A full roster browse/list page independent of search (§5 — not needed
  yet, cheap to add later if it becomes needed).
- Editing `departmentId` or `hireDate` (§2, §3).
