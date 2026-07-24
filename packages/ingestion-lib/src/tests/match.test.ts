import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool, INTERNAL_API_URL } from "../support/connections.js";
import { resetTestDatabase } from "../support/reset.js";
import { SEED } from "../support/seed-ids.js";
import { matchOfficer } from "../match.js";

describe("matchOfficer (DESIGN.md §6)", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createPool(INTERNAL_API_URL);
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("clean high-confidence match: post_certification_id matches exactly one officer and the reported name agrees", async () => {
    const result = await matchOfficer(pool, {
      postCertificationId: SEED.officers.janeDoe.postCertificationId,
      name: SEED.officers.janeDoe.name,
    });
    expect(result).toEqual({ officerId: SEED.officers.janeDoe.id, confidence: "high" });
  });

  it("still high confidence when only post_certification_id is given (no name to check agreement against)", async () => {
    const result = await matchOfficer(pool, {
      postCertificationId: SEED.officers.janeDoe.postCertificationId,
    });
    expect(result).toEqual({ officerId: SEED.officers.janeDoe.id, confidence: "high" });
  });

  it("medium-confidence match: name + department fuzzy-match a single officer, no post_certification_id given", async () => {
    const result = await matchOfficer(pool, {
      name: "Jane Doe",
      departmentName: SEED.officers.janeDoe.departmentName,
    });
    expect(result).toEqual({ officerId: SEED.officers.janeDoe.id, confidence: "medium" });
  });

  it("medium-confidence match tolerates a minor name typo via fuzzy matching", async () => {
    const result = await matchOfficer(pool, {
      name: "Jane Do",
      departmentName: SEED.officers.janeDoe.departmentName,
    });
    expect(result).toEqual({ officerId: SEED.officers.janeDoe.id, confidence: "medium" });
  });

  it("§6 conflict rule: post_certification_id says one officer, name clearly says a different one -- forced to low/null, never resolved automatically", async () => {
    const result = await matchOfficer(pool, {
      postCertificationId: SEED.officers.janeDoe.postCertificationId, // -> Jane Doe
      name: SEED.officers.robertSmith.name, // "Robert Smith" -- a different, unrelated officer
    });
    expect(result).toEqual({ officerId: null, confidence: "low" });
  });

  it("total no-match: nothing in officers resembles the given post_certification_id, name, or department", async () => {
    const result = await matchOfficer(pool, {
      postCertificationId: "CA-POST-DOES-NOT-EXIST",
      name: "Nobody Real",
      departmentName: "Nonexistent Department",
    });
    expect(result).toEqual({ officerId: null, confidence: "low" });
  });

  it("total no-match: only a name+department given, and neither matches any officer", async () => {
    const result = await matchOfficer(pool, {
      name: "Completely Unknown Person",
      departmentName: "A Department That Does Not Exist",
    });
    expect(result).toEqual({ officerId: null, confidence: "low" });
  });

  it("no signals at all -> low/null", async () => {
    const result = await matchOfficer(pool, {});
    expect(result).toEqual({ officerId: null, confidence: "low" });
  });

  it("a post_certification_id that matches zero officers does not fall back to name+department matching", async () => {
    // Even though name+departmentName here would cleanly match Jane Doe on
    // their own (see the medium-confidence test above), an unresolvable
    // primary signal must not be silently discarded in favor of the
    // secondary one -- INGESTION_DESIGN.md's matchOfficer contract treats an
    // inconsistent post_certification_id as its own low-confidence case,
    // not as "id absent."
    const result = await matchOfficer(pool, {
      postCertificationId: "CA-POST-UNKNOWN",
      name: "Jane Doe",
      departmentName: SEED.officers.janeDoe.departmentName,
    });
    expect(result).toEqual({ officerId: null, confidence: "low" });
  });
});
