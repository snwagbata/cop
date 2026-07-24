import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, closeAllPools, authHeader, loginAsAdmin } from "./helpers.js";
import { resetDb, superPool, TEST_ADMIN } from "./db.js";

// Seed data (db/seed/0001_synthetic_sample_data.sql): Maria Nguyen (013) is
// the one officer seeded with a photo_url, left unconfirmed by default --
// see that file's comment for why. Jane Doe (011) and Robert Smith (012)
// have no photo_url at all, so they're useful "nothing to confirm" cases.
const MARIA_NGUYEN = "00000000-0000-0000-0000-000000000013";
const JANE_DOE_NO_PHOTO = "00000000-0000-0000-0000-000000000011";
const NONEXISTENT_UUID = "99999999-9999-9999-9999-999999999999";
const SEED_PHOTO_URL = "https://placehold.co/200x200?text=Officer+Photo";

async function latestRevisionFor(
  recordId: string,
): Promise<{ record_type: string; change_type: string; changed_by: string; diff: unknown } | undefined> {
  const res = await superPool.query(
    `SELECT record_type, change_type, changed_by, diff FROM record_revisions WHERE record_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [recordId],
  );
  return res.rows[0];
}

async function officerRow(id: string) {
  const res = await superPool.query(
    `SELECT photo_url, photo_confirmed, photo_confirmed_by, photo_confirmed_at FROM officers WHERE id = $1`,
    [id],
  );
  return res.rows[0];
}

describe("officer photo-verification review gate", () => {
  let token: string;

  beforeEach(async () => {
    await resetDb();
    token = await loginAsAdmin();
  });

  afterAll(async () => {
    await closeAllPools();
  });

  describe("GET /api/internal/officers/pending-photos", () => {
    it("lists officers with an unconfirmed photo_url and nobody else", async () => {
      const res = await request(app)
        .get("/api/internal/officers/pending-photos")
        .set(...authHeader(token));

      expect(res.status).toBe(200);
      expect(res.body.officers).toHaveLength(1);
      expect(res.body.officers[0]).toMatchObject({
        id: MARIA_NGUYEN,
        firstName: "Maria",
        lastName: "Nguyen",
        departmentName: "Shelbyville Police Department (fictional)",
        badgeNumber: "202",
        photoUrl: SEED_PHOTO_URL,
      });
      expect(typeof res.body.officers[0].createdAt).toBe("string");
    });

    it("no longer lists an officer once their photo is confirmed", async () => {
      await request(app)
        .post(`/api/internal/officers/${MARIA_NGUYEN}/confirm-photo`)
        .set(...authHeader(token));

      const res = await request(app)
        .get("/api/internal/officers/pending-photos")
        .set(...authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.officers).toEqual([]);
    });

    it("requires authentication", async () => {
      const res = await request(app).get("/api/internal/officers/pending-photos");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/internal/officers/:id/confirm-photo", () => {
    it("confirms the photo, sets confirmed_by/at, and writes a record_revisions row", async () => {
      const res = await request(app)
        .post(`/api/internal/officers/${MARIA_NGUYEN}/confirm-photo`)
        .set(...authHeader(token));

      expect(res.status).toBe(200);
      expect(res.body.officer).toMatchObject({
        id: MARIA_NGUYEN,
        photoUrl: SEED_PHOTO_URL,
        photoConfirmed: true,
      });

      const row = await officerRow(MARIA_NGUYEN);
      expect(row.photo_confirmed).toBe(true);
      expect(row.photo_confirmed_by).toBe(TEST_ADMIN.id);
      expect(row.photo_confirmed_at).not.toBeNull();
      expect(row.photo_url).toBe(SEED_PHOTO_URL);

      const revision = await latestRevisionFor(MARIA_NGUYEN);
      expect(revision).toMatchObject({ record_type: "officer", change_type: "update", changed_by: TEST_ADMIN.id });
      expect(revision!.diff).toMatchObject({ photoConfirmed: true });
    });

    it("returns 404 for a nonexistent officer", async () => {
      const res = await request(app)
        .post(`/api/internal/officers/${NONEXISTENT_UUID}/confirm-photo`)
        .set(...authHeader(token));
      expect(res.status).toBe(404);
    });

    it("returns 400 when the officer has no photo_url", async () => {
      const res = await request(app)
        .post(`/api/internal/officers/${JANE_DOE_NO_PHOTO}/confirm-photo`)
        .set(...authHeader(token));
      expect(res.status).toBe(400);
    });

    it("returns 400 when the photo is already confirmed", async () => {
      await request(app)
        .post(`/api/internal/officers/${MARIA_NGUYEN}/confirm-photo`)
        .set(...authHeader(token));

      const res = await request(app)
        .post(`/api/internal/officers/${MARIA_NGUYEN}/confirm-photo`)
        .set(...authHeader(token));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("already_confirmed");
    });

    it("requires authentication", async () => {
      const res = await request(app).post(`/api/internal/officers/${MARIA_NGUYEN}/confirm-photo`);
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/internal/officers/:id/reject-photo", () => {
    it("clears photo_url and leaves photo_confirmed false, and writes a record_revisions row", async () => {
      const res = await request(app)
        .post(`/api/internal/officers/${MARIA_NGUYEN}/reject-photo`)
        .set(...authHeader(token));

      expect(res.status).toBe(200);
      expect(res.body.officer).toMatchObject({
        id: MARIA_NGUYEN,
        photoUrl: null,
        photoConfirmed: false,
      });

      const row = await officerRow(MARIA_NGUYEN);
      expect(row.photo_url).toBeNull();
      expect(row.photo_confirmed).toBe(false);
      expect(row.photo_confirmed_by).toBeNull();
      expect(row.photo_confirmed_at).toBeNull();

      const revision = await latestRevisionFor(MARIA_NGUYEN);
      expect(revision).toMatchObject({ record_type: "officer", change_type: "update", changed_by: TEST_ADMIN.id });
      expect(revision!.diff).toMatchObject({ photoUrl: null, photoRejected: true });
    });

    it("removes the officer from the pending-photos queue after rejection", async () => {
      await request(app)
        .post(`/api/internal/officers/${MARIA_NGUYEN}/reject-photo`)
        .set(...authHeader(token));

      const res = await request(app)
        .get("/api/internal/officers/pending-photos")
        .set(...authHeader(token));
      expect(res.body.officers).toEqual([]);
    });

    it("returns 404 for a nonexistent officer", async () => {
      const res = await request(app)
        .post(`/api/internal/officers/${NONEXISTENT_UUID}/reject-photo`)
        .set(...authHeader(token));
      expect(res.status).toBe(404);
    });

    it("returns 400 when the officer has no photo_url", async () => {
      const res = await request(app)
        .post(`/api/internal/officers/${JANE_DOE_NO_PHOTO}/reject-photo`)
        .set(...authHeader(token));
      expect(res.status).toBe(400);
    });

    it("returns 400 when the photo is already confirmed (nothing pending to reject)", async () => {
      await request(app)
        .post(`/api/internal/officers/${MARIA_NGUYEN}/confirm-photo`)
        .set(...authHeader(token));

      const res = await request(app)
        .post(`/api/internal/officers/${MARIA_NGUYEN}/reject-photo`)
        .set(...authHeader(token));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("already_confirmed");
    });

    it("requires authentication", async () => {
      const res = await request(app).post(`/api/internal/officers/${MARIA_NGUYEN}/reject-photo`);
      expect(res.status).toBe(401);
    });
  });
});
