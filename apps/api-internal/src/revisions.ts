import type { Queryable } from "./db.js";

/**
 * record_revisions.record_type is a DB CHECK constraint limited to exactly
 * four values (migration 0011, mirroring DESIGN.md §4) -- 'department' and
 * a bare 'citation' concept are deliberately not among them. Keep this type
 * in sync with that constraint rather than the broader shared-types surface.
 */
export type RevisionRecordType = "officer" | "incident" | "outcome" | "source";
export type RevisionChangeType = "create" | "update" | "approve" | "reject" | "dispute_resolution";

/**
 * Writes one record_revisions row. Callers are responsible for running this
 * inside the same transaction as the write it documents (pass the checked-
 * out PoolClient, not the pool) -- same pattern as the review-queue approve
 * flow (DESIGN.md §3, §7): a record and its revision row are never allowed
 * to land as two separate commits.
 */
export async function writeRecordRevision(
  client: Queryable,
  params: {
    recordType: RevisionRecordType;
    recordId: string;
    changeType: RevisionChangeType;
    diff: unknown;
    changedBy: string;
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO record_revisions (record_type, record_id, change_type, diff, changed_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [params.recordType, params.recordId, params.changeType, JSON.stringify(params.diff), params.changedBy],
  );
  return result.rows[0].id;
}
