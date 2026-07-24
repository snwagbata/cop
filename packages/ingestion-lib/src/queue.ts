import type { IncidentCandidateProposal } from "@cop/shared-types";
import type { CandidateItem, MatchResult, Queryable } from "./types.js";

// Mirrors apps/api-public/src/routes/tips.ts's NO_DEPARTMENT_PLACEHOLDER --
// IncidentCandidateProposal.departmentName is required, but a pipeline item
// legitimately may not have resolved a department name yet.
const NO_DEPARTMENT_PLACEHOLDER = "Unknown — reported via automated ingestion pipeline";

function buildProposal(item: CandidateItem, matchResult: MatchResult): IncidentCandidateProposal {
  const noteParts: string[] = [];
  if (item.note) {
    noteParts.push(item.note);
  }
  if (item.postCertificationIdAsReported) {
    // Not a dedicated field on IncidentCandidateProposal -- surfaced in the
    // note so a reviewer can see the reported POST id even when matchOfficer
    // didn't resolve it to a confident match (e.g. the §6 conflict rule
    // fired, or it matched zero/multiple officers rows).
    noteParts.push(`Reported post_certification_id: ${item.postCertificationIdAsReported}.`);
  }

  return {
    type: "incident_candidate",
    // Matches IncidentCandidateProposal's documented convention: officerId
    // set when matched, officerName set when not -- never both.
    officerId: matchResult.officerId ?? undefined,
    officerName: matchResult.officerId ? undefined : item.officerNameAsReported,
    departmentName: item.departmentNameAsReported ?? NO_DEPARTMENT_PLACEHOLDER,
    incidentType: item.incidentType ?? "other",
    shortDescription: item.shortDescription,
    date: item.dateAsReported,
    note: noteParts.length > 0 ? noteParts.join(" ") : undefined,
    externalUrl: item.externalUrl,
  };
}

/**
 * Writes one candidate to `sources` + `review_queue`, in that order, same
 * two-insert-in-one-transaction pattern as apps/api-public/src/routes/
 * tips.ts. The caller owns the transaction (BEGIN/COMMIT/ROLLBACK) -- pass
 * a checked-out PoolClient, same contract as
 * apps/api-internal/src/revisions.ts's writeRecordRevision -- and is
 * responsible for calling hasBeenQueued (dedupe.ts) first; this function
 * does not dedupe on its own, it only writes. (migration 0019's partial
 * unique index on sources(source_type, external_ref) is the last-resort
 * backstop if a caller skips that check.)
 */
export async function queueCandidate(
  client: Queryable,
  item: CandidateItem,
  matchResult: MatchResult,
): Promise<{ sourceId: string; reviewQueueId: string }> {
  const sourceResult = await client.query<{ id: string }>(
    `INSERT INTO sources (source_type, url, reliability_tier, external_ref)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [item.sourceType, item.externalUrl ?? null, item.reliabilityTier, item.externalRef ?? null],
  );
  const sourceId = sourceResult.rows[0].id;

  const proposal = buildProposal(item, matchResult);

  const reviewQueueResult = await client.query<{ id: string }>(
    `INSERT INTO review_queue (proposed_record, source_id, match_confidence, status)
     VALUES ($1, $2, $3, 'pending')
     RETURNING id`,
    [JSON.stringify(proposal), sourceId, matchResult.confidence],
  );

  return { sourceId, reviewQueueId: reviewQueueResult.rows[0].id };
}
