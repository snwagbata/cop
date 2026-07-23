import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, closeAllPools, authHeader, loginAsAdmin } from "./helpers.js";
import { resetDb, superPool, TEST_ADMIN } from "./db.js";

// Seed fixed UUIDs (db/seed/0001_synthetic_sample_data.sql).
const SPRINGFIELD_DEPT = "00000000-0000-0000-0000-000000000001";
const SHELBYVILLE_DEPT = "00000000-0000-0000-0000-000000000002";
const OFFICER_ROBERT_SMITH = "00000000-0000-0000-0000-000000000012";
const SOURCE_TIER1_COURT_DOC = "00000000-0000-0000-0000-000000000032"; // tier1_primary_legal_doc
const SOURCE_TIER2_REGISTRY = "00000000-0000-0000-0000-000000000031"; // tier2_official_dataset
const SOURCE_TIER3_NEWS = "00000000-0000-0000-0000-000000000033"; // tier3_established_news

async function countRecordRevisions(): Promise<number> {
  const res = await superPool.query<{ count: string }>(`SELECT count(*) FROM record_revisions`);
  return Number(res.rows[0].count);
}

describe("review-queue", () => {
  let token: string;

  beforeEach(async () => {
    await resetDb();
    token = await loginAsAdmin();
  });

  afterAll(async () => {
    await closeAllPools();
  });

  it("GET /review-queue?status=pending returns the seeded pending item", async () => {
    const res = await request(app)
      .get("/api/internal/review-queue?status=pending")
      .set(...authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].status).toBe("pending");
    expect(res.body.items[0].proposedRecord.type).toBe("incident_candidate");
    expect(res.body.items[0].proposedRecord.officerName).toBe("R. Smith");
    expect(res.body.items[0].source).toMatchObject({ id: SOURCE_TIER3_NEWS });
  });

  it("GET /review-queue with an invalid status returns 400", async () => {
    const res = await request(app)
      .get("/api/internal/review-queue?status=bogus")
      .set(...authHeader(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("approving an officer_candidate creates the officer row and a record_revisions entry", async () => {
    const id = "20000000-0000-0000-0000-000000000001";
    await superPool.query(
      `INSERT INTO review_queue (id, proposed_record, source_id, match_confidence, status)
       VALUES ($1, $2, $3, 'medium', 'pending')`,
      [
        id,
        JSON.stringify({
          type: "officer_candidate",
          firstName: "Casey",
          lastName: "Rivera",
          departmentName: "Springfield Police Department (fictional)",
          badgeNumber: "909",
        }),
        SOURCE_TIER2_REGISTRY,
      ],
    );
    const before = await countRecordRevisions();

    const res = await request(app)
      .post(`/api/internal/review-queue/${id}/approve`)
      .set(...authHeader(token))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe("approved");
    expect(res.body.item.reviewerId).toBe(TEST_ADMIN.id);

    const officerRes = await superPool.query(
      `SELECT id, first_name, last_name, department_id, badge_number, employment_status
         FROM officers WHERE first_name = 'Casey' AND last_name = 'Rivera'`,
    );
    expect(officerRes.rows).toHaveLength(1);
    const officer = officerRes.rows[0];
    expect(officer.department_id).toBe(SPRINGFIELD_DEPT);
    expect(officer.badge_number).toBe("909");
    expect(officer.employment_status).toBe("active");

    const revisionRes = await superPool.query(
      `SELECT record_type, change_type, changed_by FROM record_revisions WHERE record_id = $1`,
      [officer.id],
    );
    expect(revisionRes.rows).toHaveLength(1);
    expect(revisionRes.rows[0]).toMatchObject({
      record_type: "officer",
      change_type: "create",
      changed_by: TEST_ADMIN.id,
    });

    expect(await countRecordRevisions()).toBe(before + 1);
  });

  it("approving an incident_candidate with no resolvable officerId returns 400 requiring edits.officerId", async () => {
    const pendingRes = await superPool.query<{ id: string }>(
      `SELECT id FROM review_queue WHERE status = 'pending' LIMIT 1`,
    );
    const id = pendingRes.rows[0].id;

    const res = await request(app)
      .post(`/api/internal/review-queue/${id}/approve`)
      .set(...authHeader(token))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("officer_not_resolved");

    // Refusing to guess must not have consumed the item -- it's still pending.
    const stillPending = await superPool.query<{ status: string }>(`SELECT status FROM review_queue WHERE id = $1`, [
      id,
    ]);
    expect(stillPending.rows[0].status).toBe("pending");
  });

  it("providing edits.officerId lets the same incident_candidate approve successfully", async () => {
    const pendingRes = await superPool.query<{ id: string }>(
      `SELECT id FROM review_queue WHERE status = 'pending' LIMIT 1`,
    );
    const id = pendingRes.rows[0].id;

    // NOTE / real behavior worth flagging: officerId alone is *not* actually
    // sufficient here. The seed's proposed_record has no "date" field (it's
    // optional on IncidentCandidateProposal), and promoteReviewQueueItem
    // unconditionally requires `effective.date` to be truthy for an
    // incident_candidate -- there's no fallback to e.g. the cited source's
    // publication_date. Without also supplying edits.date, this same request
    // fails with 400 invalid_request "date is required." (confirmed by
    // running it without the date edit below). That's arguably a rough edge
    // in the approve flow: a reviewer resolving *only* the ambiguous officer
    // match (the thing DESIGN.md §6 calls out as needing a human) is blocked
    // on an unrelated missing field the UI would also need to surface.
    const missingDate = await request(app)
      .post(`/api/internal/review-queue/${id}/approve`)
      .set(...authHeader(token))
      .send({ edits: { officerId: OFFICER_ROBERT_SMITH } });
    expect(missingDate.status).toBe(400);
    expect(missingDate.body.error).toBe("invalid_request");
    expect(missingDate.body.message).toContain("date");

    const res = await request(app)
      .post(`/api/internal/review-queue/${id}/approve`)
      .set(...authHeader(token))
      .send({ edits: { officerId: OFFICER_ROBERT_SMITH, date: "2022-06-01" } });

    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe("approved");

    const incidentRes = await superPool.query(
      `SELECT i.id, i.incident_type, io.officer_id
         FROM incidents i
         JOIN incident_officers io ON io.incident_id = i.id
        WHERE io.officer_id = $1 AND i.incident_type = 'use_of_force'`,
      [OFFICER_ROBERT_SMITH],
    );
    expect(incidentRes.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("rejecting a pending item sets status/reason and writes no spurious record_revisions row", async () => {
    const id = "20000000-0000-0000-0000-000000000002";
    await superPool.query(
      `INSERT INTO review_queue (id, proposed_record, source_id, match_confidence, status)
       VALUES ($1, $2, $3, 'low', 'pending')`,
      [
        id,
        JSON.stringify({
          type: "officer_candidate",
          firstName: "Nope",
          lastName: "Reject-Me",
          departmentName: "Springfield Police Department (fictional)",
        }),
        SOURCE_TIER3_NEWS,
      ],
    );
    const before = await countRecordRevisions();

    const res = await request(app)
      .post(`/api/internal/review-queue/${id}/reject`)
      .set(...authHeader(token))
      .send({ reason: "Cannot verify this candidate against any primary source." });

    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe("rejected");
    expect(res.body.item.proposedRecord.rejectionReason).toBe(
      "Cannot verify this candidate against any primary source.",
    );
    expect(res.body.item.reviewerId).toBe(TEST_ADMIN.id);

    expect(await countRecordRevisions()).toBe(before);

    // No officer row should have been created either.
    const officerRes = await superPool.query(`SELECT id FROM officers WHERE first_name = 'Nope'`);
    expect(officerRes.rows).toHaveLength(0);
  });

  it("rejecting without a reason returns 400", async () => {
    const pendingRes = await superPool.query<{ id: string }>(
      `SELECT id FROM review_queue WHERE status = 'pending' LIMIT 1`,
    );
    const res = await request(app)
      .post(`/api/internal/review-queue/${pendingRes.rows[0].id}/reject`)
      .set(...authHeader(token))
      .send({});
    expect(res.status).toBe(400);
  });

  it("rejecting an already-reviewed item returns 400 already_reviewed", async () => {
    const id = "20000000-0000-0000-0000-000000000003";
    await superPool.query(
      `INSERT INTO review_queue (id, proposed_record, match_confidence, status)
       VALUES ($1, $2, 'low', 'rejected')`,
      [id, JSON.stringify({ type: "officer_candidate", firstName: "Already", lastName: "Done", departmentName: "x" })],
    );
    const res = await request(app)
      .post(`/api/internal/review-queue/${id}/reject`)
      .set(...authHeader(token))
      .send({ reason: "test" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("already_reviewed");
  });

  it("GET /review-queue/digest returns correct counts for a controlled DB state", async () => {
    const now = Date.now();
    const days = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();

    const proposal = (n: number) =>
      JSON.stringify({
        type: "officer_candidate",
        firstName: `Digest${n}`,
        lastName: "Fixture",
        departmentName: "Springfield Police Department (fictional)",
      });

    // A: within window, high confidence, still pending.
    await superPool.query(
      `INSERT INTO review_queue (id, proposed_record, match_confidence, status, created_at)
       VALUES ('30000000-0000-0000-0000-000000000001', $1, 'high', 'pending', $2)`,
      [proposal(1), days(2)],
    );
    // B: within window, medium confidence, still pending (needs attention).
    await superPool.query(
      `INSERT INTO review_queue (id, proposed_record, match_confidence, status, created_at)
       VALUES ('30000000-0000-0000-0000-000000000002', $1, 'medium', 'pending', $2)`,
      [proposal(2), days(3)],
    );
    // C: outside window entirely -- must not count toward newCount.
    await superPool.query(
      `INSERT INTO review_queue (id, proposed_record, match_confidence, status, created_at)
       VALUES ('30000000-0000-0000-0000-000000000003', $1, 'high', 'pending', $2)`,
      [proposal(3), days(10)],
    );
    // D: approved this week, but created well outside the window -- proves
    // approvedCount uses reviewed_at, not created_at.
    await superPool.query(
      `INSERT INTO review_queue (id, proposed_record, match_confidence, status, created_at, reviewed_at, reviewer_id)
       VALUES ('30000000-0000-0000-0000-000000000004', $1, 'high', 'approved', $2, $3, $4)`,
      [proposal(4), days(20), days(1), TEST_ADMIN.id],
    );
    // E: rejected this week, created outside the window.
    await superPool.query(
      `INSERT INTO review_queue (id, proposed_record, match_confidence, status, created_at, reviewed_at, reviewer_id)
       VALUES ('30000000-0000-0000-0000-000000000005', $1, 'low', 'rejected', $2, $3, $4)`,
      [proposal(5), days(20), days(1), TEST_ADMIN.id],
    );
    // A second open dispute (seed already has one open dispute).
    await superPool.query(
      `INSERT INTO disputes (officer_id, requester_name, requester_role, claim, status)
       VALUES ($1, 'Digest Fixture Requester', 'other', 'Digest test dispute.', 'open')`,
      [OFFICER_ROBERT_SMITH],
    );
    // A resolved dispute -- must not count toward openDisputeCount.
    await superPool.query(
      `INSERT INTO disputes (officer_id, requester_name, requester_role, claim, status, resolution_notes, resolved_by, resolved_at)
       VALUES ($1, 'Digest Fixture Resolved', 'other', 'Already resolved.', 'resolved_no_change', 'n/a', $2, now())`,
      [OFFICER_ROBERT_SMITH, TEST_ADMIN.id],
    );

    const res = await request(app)
      .get("/api/internal/review-queue/digest?days=7")
      .set(...authHeader(token));

    expect(res.status).toBe(200);
    // newCount: seed's pending row (created "now") + A + B = 3.
    expect(res.body.digest.newCount).toBe(3);
    // highConfidenceCount: only A is high-confidence within the window.
    expect(res.body.digest.highConfidenceCount).toBe(1);
    // needsAttentionCount: seed's pending low-confidence row + B (medium).
    expect(res.body.digest.needsAttentionCount).toBe(2);
    expect(res.body.digest.approvedCount).toBe(1);
    expect(res.body.digest.rejectedCount).toBe(1);
    // openDisputeCount: seed's 1 + the new open one = 2 (resolved one excluded).
    expect(res.body.digest.openDisputeCount).toBe(2);
  });

  it("POST /bulk-approve handles a mixed batch: one success, one gate failure, one nonexistent id -- independently", async () => {
    const successId = "20000000-0000-0000-0000-000000000010";
    await superPool.query(
      `INSERT INTO review_queue (id, proposed_record, source_id, match_confidence, status)
       VALUES ($1, $2, $3, 'high', 'pending')`,
      [
        successId,
        JSON.stringify({
          type: "officer_candidate",
          firstName: "Bulk",
          lastName: "Success",
          departmentName: "Springfield Police Department (fictional)",
        }),
        SOURCE_TIER1_COURT_DOC,
      ],
    );

    const gateFailRes = await superPool.query<{ id: string }>(
      `SELECT id FROM review_queue WHERE status = 'pending' AND match_confidence = 'low' LIMIT 1`,
    );
    const gateFailId = gateFailRes.rows[0].id; // seed's tier3/low-confidence item

    const nonexistentId = "99999999-9999-9999-9999-999999999999";

    const res = await request(app)
      .post("/api/internal/review-queue/bulk-approve")
      .set(...authHeader(token))
      .send({ reviewQueueIds: [successId, gateFailId, nonexistentId] });

    expect(res.status).toBe(200);
    expect(res.body.approved).toEqual([successId]);
    expect(res.body.failed).toHaveLength(2);
    const failedIds = res.body.failed.map((f: { id: string }) => f.id).sort();
    expect(failedIds).toEqual([gateFailId, nonexistentId].sort());

    // The successful item's failure-neighbors didn't block or roll it back.
    const officerRes = await superPool.query(`SELECT id FROM officers WHERE first_name = 'Bulk' AND last_name = 'Success'`);
    expect(officerRes.rows).toHaveLength(1);

    const successItem = await superPool.query<{ status: string }>(`SELECT status FROM review_queue WHERE id = $1`, [
      successId,
    ]);
    expect(successItem.rows[0].status).toBe("approved");

    // The gate-failed item is untouched -- still pending, not silently approved.
    const gateFailItem = await superPool.query<{ status: string }>(`SELECT status FROM review_queue WHERE id = $1`, [
      gateFailId,
    ]);
    expect(gateFailItem.rows[0].status).toBe("pending");
  });

  it("POST /bulk-approve rejects an empty reviewQueueIds array with 400", async () => {
    const res = await request(app)
      .post("/api/internal/review-queue/bulk-approve")
      .set(...authHeader(token))
      .send({ reviewQueueIds: [] });
    expect(res.status).toBe(400);
  });
});
