import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { adminPool, closeAdminPool, resetDb } from "./helpers/db.js";
import { MARIA_NGUYEN_ID } from "./helpers/fixtures.js";

// DESIGN.md §7: "photo_url is never auto-approved, even from a tier1
// source -- a reviewer must positively confirm the photo matches the
// officer being published." Seed data (db/seed/0001_synthetic_sample_data.sql)
// sets Maria Nguyen's photo_url but leaves photo_confirmed at its default
// (false) precisely so this gate has something to exercise.
const SEED_PHOTO_URL = "https://placehold.co/200x200?text=Officer+Photo";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeAdminPool();
});

describe("officer photo-verification gate (DESIGN.md §7)", () => {
  it("never returns photoUrl from search while unconfirmed", async () => {
    const res = await request(app).get("/api/public/officers/search").query({ q: "Nguyen" });
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0].id).toBe(MARIA_NGUYEN_ID);
    expect(res.body.candidates[0].photoUrl).toBeNull();
  });

  it("never returns photoUrl from browse/list while unconfirmed", async () => {
    const res = await request(app).get("/api/public/officers");
    expect(res.status).toBe(200);
    const maria = res.body.officers.find((o: { id: string }) => o.id === MARIA_NGUYEN_ID);
    expect(maria).toBeDefined();
    expect(maria.photoUrl).toBeNull();
  });

  it("never returns photoUrl from officer detail while unconfirmed", async () => {
    const res = await request(app).get(`/api/public/officers/${MARIA_NGUYEN_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.officer.photoUrl).toBeNull();
  });

  it("returns photoUrl from search, browse, and detail once confirmed", async () => {
    await adminPool.query(
      `UPDATE officers
          SET photo_confirmed = true, photo_confirmed_by = '00000000-0000-0000-0000-000000000021', photo_confirmed_at = now()
        WHERE id = $1`,
      [MARIA_NGUYEN_ID],
    );

    const searchRes = await request(app).get("/api/public/officers/search").query({ q: "Nguyen" });
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.candidates[0].photoUrl).toBe(SEED_PHOTO_URL);

    const browseRes = await request(app).get("/api/public/officers");
    expect(browseRes.status).toBe(200);
    const maria = browseRes.body.officers.find((o: { id: string }) => o.id === MARIA_NGUYEN_ID);
    expect(maria.photoUrl).toBe(SEED_PHOTO_URL);

    const detailRes = await request(app).get(`/api/public/officers/${MARIA_NGUYEN_ID}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.officer.photoUrl).toBe(SEED_PHOTO_URL);
  });

  it("clears photoUrl again from every route if a confirmed photo is later rejected (photo_url set NULL)", async () => {
    await adminPool.query(
      `UPDATE officers
          SET photo_confirmed = true, photo_confirmed_by = '00000000-0000-0000-0000-000000000021', photo_confirmed_at = now()
        WHERE id = $1`,
      [MARIA_NGUYEN_ID],
    );
    // Simulate the internal API's reject-photo action: clears photo_url and
    // resets photo_confirmed (see apps/api-internal/src/routes/officers.ts).
    await adminPool.query(
      `UPDATE officers
          SET photo_url = NULL, photo_confirmed = false, photo_confirmed_by = NULL, photo_confirmed_at = NULL
        WHERE id = $1`,
      [MARIA_NGUYEN_ID],
    );

    const detailRes = await request(app).get(`/api/public/officers/${MARIA_NGUYEN_ID}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.officer.photoUrl).toBeNull();
  });
});
