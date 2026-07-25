# Officer Detail Page + Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first officer detail/edit capability in the admin app — today there is no `GET /:id`, no edit endpoint, and no admin page for viewing or editing an officer beyond the creation form and the photo-review queue. This is the prerequisite for a future officer-merge feature (needs a real side-by-side comparison) but stands on its own as a real gap: reviewers currently cannot look up an officer's full record or fix a typo without hand-editing the database.

**Architecture:** Two new `apps/api-internal` routes (`GET`/`PATCH /api/internal/officers/:id`) following the existing router's conventions exactly (`UUID_RE`, `asyncHandler`, `ApiError`, `writeRecordRevision`). A new internal-only type (`InternalOfficerDetail`) separate from the public-facing `OfficerDetail`, since the public type is missing fields (`postCertificationId`, `hireDate`) this needs. A new admin page (`OfficerDetailPage`) with a view/edit toggle, plus three small, isolated discoverability additions elsewhere in the admin app — none of which touch `OfficerSearchPicker`'s actual picker behavior (its dropdown results must keep firing `onSelect`, not navigate away).

**Tech Stack:** Same as the rest of `apps/api-internal`/`apps/admin` — Express, `pg`, React, `react-router-dom`, Vitest + Supertest. No new dependencies.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-25-officer-detail-and-editing-design.md` — read for full context; this plan implements it exactly (including its two corrections about `OfficerSearchPicker` and the incident/outcome counts not being links).
- `departmentId` and `hireDate` are **not editable** via `PATCH /:id` — department changes need the separate, not-yet-built "transfer officer" feature to keep `officer_department_history` in sync; a direct edit here would silently desync it.
- Both new endpoints use the **same permission level as officer creation** — any authenticated reviewer, no admin-role gating. (Contrast with the future merge feature, which will be admin-only.)
- Every write to `officers` in the `PATCH` handler must write a `record_revisions` row in the same transaction, using the existing `writeRecordRevision` helper (`apps/api-internal/src/revisions.ts`) — this table is described in migration 0011's own comment as "the primary evidentiary record for defeating an actual-malice claim," not an optional nicety.
- Changing `photoUrl` via `PATCH` must reset `photo_confirmed`/`photo_confirmed_by`/`photo_confirmed_at` to false/null/null — migration 0017's comment explicitly flags this as required for whenever an edit endpoint existed.
- No new npm dependencies.

---

### Task 1: Backend — `GET`/`PATCH /api/internal/officers/:id`

**Files:**
- Modify: `packages/shared-types/src/index.ts`
- Modify: `apps/api-internal/src/routes/officers.ts`
- Test: `apps/api-internal/test/officerDetail.test.ts` (new)

**Interfaces:**
- Consumes: `writeRecordRevision` (`apps/api-internal/src/revisions.ts`, unchanged), `UUID_RE`/`VALID_EMPLOYMENT_STATUSES` (already defined at the top of `officers.ts`, unchanged).
- Produces: `InternalOfficerDetail` and `UpdateOfficerRequest` types (Task 2 imports both); the two new routes (Task 2's admin API client calls them).

- [ ] **Step 1: Write the failing tests**

Create `apps/api-internal/test/officerDetail.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, closeAllPools, authHeader, loginAsAdmin, loginAsReviewer } from "./helpers.js";
import { resetDb } from "./db.js";
import { superPool } from "./db.js";

const ROBERT_SMITH = "00000000-0000-0000-0000-000000000012"; // the seeded "wandering officer" -- has 2 department_department_history rows
const JANE_DOE = "00000000-0000-0000-0000-000000000011";
const SPRINGFIELD_DEPT = "00000000-0000-0000-0000-000000000001";
const SHELBYVILLE_DEPT = "00000000-0000-0000-0000-000000000002";

describe("GET /officers/:id", () => {
  let token: string;

  beforeEach(async () => {
    await resetDb();
    token = await loginAsReviewer(); // not admin -- proves no admin gating
  });

  afterAll(async () => {
    await closeAllPools();
  });

  it("requires authentication", async () => {
    const res = await request(app).get(`/api/internal/officers/${ROBERT_SMITH}`);
    expect(res.status).toBe(401);
  });

  it("rejects a malformed id with 400", async () => {
    const res = await request(app).get("/api/internal/officers/not-a-uuid").set(...authHeader(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("404s for an unknown id", async () => {
    const res = await request(app)
      .get("/api/internal/officers/00000000-0000-0000-0000-0000000000ff")
      .set(...authHeader(token));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("returns full internal detail including department history for the seeded wandering officer", async () => {
    const res = await request(app).get(`/api/internal/officers/${ROBERT_SMITH}`).set(...authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: ROBERT_SMITH,
      firstName: "Robert",
      lastName: "Smith",
      departmentId: SPRINGFIELD_DEPT,
      departmentName: "Springfield Police Department (fictional)",
      badgeNumber: "303",
      postCertificationId: "CA-POST-000222",
    });
    expect(res.body.departmentHistory).toHaveLength(2);
    const departmentIds = res.body.departmentHistory.map((h: { departmentId: string }) => h.departmentId).sort();
    expect(departmentIds).toEqual([SHELBYVILLE_DEPT, SPRINGFIELD_DEPT].sort());
    expect(typeof res.body.incidentCount).toBe("number");
    expect(typeof res.body.outcomeCount).toBe("number");
  });

  it("returns an empty department history for an officer with no history rows", async () => {
    const res = await request(app).get(`/api/internal/officers/${JANE_DOE}`).set(...authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.departmentHistory).toEqual([]);
  });
});

describe("PATCH /officers/:id", () => {
  let token: string;

  beforeEach(async () => {
    await resetDb();
    token = await loginAsReviewer();
  });

  afterAll(async () => {
    await closeAllPools();
  });

  it("requires authentication", async () => {
    const res = await request(app).patch(`/api/internal/officers/${JANE_DOE}`).send({ rank: "Sergeant" });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed id with 400", async () => {
    const res = await request(app).patch("/api/internal/officers/not-a-uuid").set(...authHeader(token)).send({ rank: "Sergeant" });
    expect(res.status).toBe(400);
  });

  it("404s for an unknown id", async () => {
    const res = await request(app)
      .patch("/api/internal/officers/00000000-0000-0000-0000-0000000000ff")
      .set(...authHeader(token))
      .send({ rank: "Sergeant" });
    expect(res.status).toBe(404);
  });

  it("400s when no editable fields are provided", async () => {
    const res = await request(app).patch(`/api/internal/officers/${JANE_DOE}`).set(...authHeader(token)).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("400s on an invalid employmentStatus", async () => {
    const res = await request(app)
      .patch(`/api/internal/officers/${JANE_DOE}`)
      .set(...authHeader(token))
      .send({ employmentStatus: "not-a-real-status" });
    expect(res.status).toBe(400);
  });

  it("400s on a blank firstName", async () => {
    const res = await request(app).patch(`/api/internal/officers/${JANE_DOE}`).set(...authHeader(token)).send({ firstName: "   " });
    expect(res.status).toBe(400);
  });

  it("updates a single field and leaves the rest unchanged", async () => {
    const res = await request(app)
      .patch(`/api/internal/officers/${JANE_DOE}`)
      .set(...authHeader(token))
      .send({ rank: "Lieutenant" });
    expect(res.status).toBe(200);

    const check = await request(app).get(`/api/internal/officers/${JANE_DOE}`).set(...authHeader(token));
    expect(check.body.rank).toBe("Lieutenant");
    expect(check.body.firstName).toBe("Jane"); // unchanged
  });

  it("explicitly clears a nullable field to null when the caller sends null (not just omits it)", async () => {
    // First give Jane a badge number to clear.
    await request(app).patch(`/api/internal/officers/${JANE_DOE}`).set(...authHeader(token)).send({ badgeNumber: "999" });

    const res = await request(app)
      .patch(`/api/internal/officers/${JANE_DOE}`)
      .set(...authHeader(token))
      .send({ badgeNumber: null });
    expect(res.status).toBe(200);

    const check = await request(app).get(`/api/internal/officers/${JANE_DOE}`).set(...authHeader(token));
    expect(check.body.badgeNumber).toBeNull();
  });

  it("resets photo_confirmed when photoUrl changes", async () => {
    await superPool.query(
      `UPDATE officers SET photo_url = 'https://example.gov/old.jpg', photo_confirmed = true, photo_confirmed_by = (SELECT id FROM reviewers LIMIT 1), photo_confirmed_at = now() WHERE id = $1`,
      [JANE_DOE],
    );

    const res = await request(app)
      .patch(`/api/internal/officers/${JANE_DOE}`)
      .set(...authHeader(token))
      .send({ photoUrl: "https://example.gov/new.jpg" });
    expect(res.status).toBe(200);

    const check = await request(app).get(`/api/internal/officers/${JANE_DOE}`).set(...authHeader(token));
    expect(check.body.photoUrl).toBe("https://example.gov/new.jpg");
    expect(check.body.photoConfirmed).toBe(false);
  });

  it("writes a record_revisions row with change_type update", async () => {
    await request(app).patch(`/api/internal/officers/${JANE_DOE}`).set(...authHeader(token)).send({ rank: "Captain" });

    const revisions = await superPool.query(
      `SELECT change_type, diff FROM record_revisions WHERE record_type = 'officer' AND record_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [JANE_DOE],
    );
    expect(revisions.rows[0].change_type).toBe("update");
    expect(revisions.rows[0].diff).toMatchObject({ rank: "Captain" });
  });

  it("does not require the admin role (loginAsReviewer succeeds)", async () => {
    // token above is already a plain reviewer login, not admin -- this
    // test's real assertion is that every other test in this file, which
    // all use loginAsReviewer, already passed. This test exists to make
    // that intent explicit rather than implicit.
    const adminToken = await loginAsAdmin();
    const res = await request(app)
      .patch(`/api/internal/officers/${JANE_DOE}`)
      .set(...authHeader(adminToken))
      .send({ rank: "Chief" });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run --workspace apps/api-internal test -- officerDetail`
Expected: FAIL — `404`/connection-refused-shaped failures, since neither route exists yet.

- [ ] **Step 3: Add the two new types**

In `packages/shared-types/src/index.ts`, find:

```ts
export interface OfficerDetail {
```

Insert immediately **before** it:

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

- [ ] **Step 4: Add the two routes**

In `apps/api-internal/src/routes/officers.ts`, find the import block:

```ts
import type {
  CreateOfficerRequest,
  CreateRecordResponse,
  EmploymentStatus,
  ListPendingPhotosResponse,
  OfficerDetail,
  OfficerSearchCandidate,
  PendingPhotoOfficer,
  SearchInternalOfficersResponse,
} from "@cop/shared-types";
```

Replace with:

```ts
import type {
  CreateOfficerRequest,
  CreateRecordResponse,
  EmploymentStatus,
  InternalOfficerDetail,
  ListPendingPhotosResponse,
  OfficerDepartmentHistoryEntry,
  OfficerDetail,
  OfficerSearchCandidate,
  PendingPhotoOfficer,
  SearchInternalOfficersResponse,
  UpdateOfficerRequest,
} from "@cop/shared-types";
```

Then, at the end of the file (after the `POST /:id/reject-photo` handler's closing `);`), append:

```ts

// ---------------------------------------------------------------------------
// GET /api/internal/officers/:id
//
// The prerequisite for a real officer detail/edit page in the admin app --
// today the only officer-fetching route is /search (narrow fields for the
// picker). Deliberately a separate type from the public-facing
// OfficerDetail (packages/shared-types) -- that type doesn't carry
// postCertificationId/hireDate at all, which this internal view needs.
// ---------------------------------------------------------------------------
officersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      throw new ApiError(400, "invalid_request", "officer id must be a valid UUID.");
    }

    const officerResult = await pool.query<{
      id: string;
      first_name: string;
      last_name: string;
      known_aliases: string[];
      department_id: string;
      department_name: string;
      badge_number: string | null;
      rank: string | null;
      hire_date: string | null;
      employment_status: EmploymentStatus;
      post_certification_id: string | null;
      photo_url: string | null;
      photo_confirmed: boolean;
      created_at: string;
    }>(
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

    const historyResult = await pool.query<{
      department_id: string;
      department_name: string;
      badge_number: string | null;
      start_date: string;
      end_date: string | null;
      separation_reason: string | null;
    }>(
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

    const departmentHistory: OfficerDepartmentHistoryEntry[] = historyResult.rows.map((h) => ({
      departmentId: h.department_id,
      departmentName: h.department_name,
      badgeNumber: h.badge_number,
      startDate: h.start_date,
      endDate: h.end_date,
      separationReason: h.separation_reason,
    }));

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
      departmentHistory,
      incidentCount: Number(countsResult.rows[0].incident_count),
      outcomeCount: Number(countsResult.rows[0].outcome_count),
    };
    res.status(200).json(response);
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/internal/officers/:id
//
// First officer-edit endpoint in this codebase. departmentId is
// deliberately NOT editable here -- a department change needs a new
// officer_department_history row (the separate, not-yet-built "transfer
// officer" feature), and a direct edit here would silently desync
// officers.department_id from that history table. Same permission level
// as officer creation (any authenticated reviewer, no admin gating) --
// contrast with the future merge feature, which will be admin-only.
//
// Uses a dynamic SET clause (only columns actually present in the request
// body) rather than reviewers.ts's simpler COALESCE-based full UPDATE --
// COALESCE can't distinguish "field omitted" from "field explicitly set to
// null," and several of this endpoint's fields (badgeNumber, rank,
// postCertificationId, photoUrl) need to support being explicitly cleared
// back to null, which reviewers.ts's two non-nullable fields (role,
// active) never needed to support.
// ---------------------------------------------------------------------------
officersRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const reviewer = req.reviewer!;
    if (!UUID_RE.test(id)) {
      throw new ApiError(400, "invalid_request", "officer id must be a valid UUID.");
    }
    const body = (req.body ?? {}) as Partial<UpdateOfficerRequest>;

    if ("employmentStatus" in body && !VALID_EMPLOYMENT_STATUSES.includes(body.employmentStatus as EmploymentStatus)) {
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
      const setClauses: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;
      for (const [key, column] of Object.entries(fieldMap)) {
        if (key in body) {
          setClauses.push(`${column} = $${paramIndex}`);
          values.push((body as Record<string, unknown>)[key]);
          paramIndex++;
        }
      }
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

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run --workspace apps/api-internal test -- officerDetail`
Expected: PASS (15 tests).

- [ ] **Step 6: Run the full apps/api-internal suite to check for regressions**

Run: `npm run --workspace apps/api-internal test`
Expected: PASS (all files, including `officersSearch.test.ts` and every other existing suite, unaffected).

- [ ] **Step 7: Commit**

```bash
git add packages/shared-types/src/index.ts apps/api-internal/src/routes/officers.ts apps/api-internal/test/officerDetail.test.ts
git commit -m "Add GET/PATCH /api/internal/officers/:id

First officer-edit endpoint in this codebase. departmentId stays
read-only here -- a real department change needs a new
officer_department_history row (a separate, not-yet-built transfer
feature), not a silent column edit that would desync it. Every edit
writes a record_revisions row in the same transaction; changing
photoUrl resets the photo_confirmed gate, per migration 0017's own
note that any future edit endpoint would need to."
```

---

### Task 2: Admin — officer detail/edit page

**Files:**
- Modify: `apps/admin/src/api/client.ts`
- Create: `apps/admin/src/pages/OfficerDetailPage.tsx`
- Create: `apps/admin/src/pages/__tests__/OfficerDetailPage.test.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `InternalOfficerDetail`/`UpdateOfficerRequest` (Task 1).
- Produces: route `/officers/:id`, nothing other tasks in this plan depend on (Task 3 links *to* this route but doesn't import anything from this page's file).

- [ ] **Step 1: Add the two API client functions**

In `apps/admin/src/api/client.ts`, find the import block's closing brace and the line just before it:

```ts
  SearchInternalOfficersResponse,
  UpdateReviewerRequest,
} from "@cop/shared-types";
```

Replace with:

```ts
  InternalOfficerDetail,
  SearchInternalOfficersResponse,
  UpdateOfficerRequest,
  UpdateReviewerRequest,
} from "@cop/shared-types";
```

Then find:

```ts
export function updateReviewer(id: string, payload: UpdateReviewerRequest): Promise<Reviewer> {
  return request<Reviewer>(`/api/internal/reviewers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: payload,
  });
}
```

Insert immediately after it:

```ts

export function fetchOfficerDetail(id: string): Promise<InternalOfficerDetail> {
  return request<InternalOfficerDetail>(`/api/internal/officers/${encodeURIComponent(id)}`);
}

export function updateOfficer(id: string, payload: UpdateOfficerRequest): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/internal/officers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: payload,
  });
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/admin/src/pages/__tests__/OfficerDetailPage.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { OfficerDetailPage } from "../OfficerDetailPage";
import * as api from "../../api/client";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return {
    ...actual,
    fetchOfficerDetail: vi.fn(),
    updateOfficer: vi.fn(),
  };
});

const DETAIL = {
  id: "00000000-0000-0000-0000-000000000012",
  firstName: "Robert",
  lastName: "Smith",
  knownAliases: [],
  departmentId: "00000000-0000-0000-0000-000000000001",
  departmentName: "Springfield Police Department (fictional)",
  badgeNumber: "303",
  rank: null,
  hireDate: "2019-06-01",
  employmentStatus: "active" as const,
  postCertificationId: "CA-POST-000222",
  photoUrl: null,
  photoConfirmed: false,
  createdAt: "2020-01-01T00:00:00.000Z",
  departmentHistory: [
    {
      departmentId: "00000000-0000-0000-0000-000000000002",
      departmentName: "Shelbyville Police Department (fictional)",
      badgeNumber: "55",
      startDate: "2015-01-01",
      endDate: "2019-05-31",
      separationReason: "terminated after sustained internal affairs investigation",
    },
  ],
  incidentCount: 2,
  outcomeCount: 1,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/officers/00000000-0000-0000-0000-000000000012"]}>
      <Routes>
        <Route path="/officers/:id" element={<OfficerDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("OfficerDetailPage", () => {
  beforeEach(() => {
    vi.mocked(api.fetchOfficerDetail).mockResolvedValue(DETAIL);
  });

  it("loads and renders the officer's detail, including department history", async () => {
    renderPage();

    expect(await screen.findByText(/Robert Smith/)).toBeInTheDocument();
    expect(screen.getByText(/CA-POST-000222/)).toBeInTheDocument();
    expect(screen.getByText(/Shelbyville Police Department \(fictional\)/)).toBeInTheDocument();
    expect(screen.getByText(/terminated after sustained internal affairs investigation/)).toBeInTheDocument();
  });

  it("toggles into edit mode and submits only the changed field", async () => {
    vi.mocked(api.updateOfficer).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(/Robert Smith/);
    await user.click(screen.getByRole("button", { name: /edit/i }));

    const rankInput = screen.getByLabelText(/rank/i);
    await user.clear(rankInput);
    await user.type(rankInput, "Lieutenant");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(api.updateOfficer).toHaveBeenCalledWith(
        "00000000-0000-0000-0000-000000000012",
        expect.objectContaining({ rank: "Lieutenant" }),
      );
    });
  });

  it("shows departmentId as read-only with a note, not an editable field", async () => {
    renderPage();
    await screen.findByText(/Robert Smith/);
    await userEvent.setup().click(screen.getByRole("button", { name: /edit/i }));

    expect(screen.queryByLabelText(/^department$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/transfer officer/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run --workspace apps/admin test -- OfficerDetailPage`
Expected: FAIL — `Cannot find module '../OfficerDetailPage'`.

- [ ] **Step 4: Write the page**

Create `apps/admin/src/pages/OfficerDetailPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { EmploymentStatus, InternalOfficerDetail } from "@cop/shared-types";
import * as api from "../api/client";
import { ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";

const EMPLOYMENT_STATUSES: EmploymentStatus[] = [
  "active",
  "inactive",
  "terminated",
  "resigned",
  "retired",
  "decertified",
];

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: InternalOfficerDetail };

/** Only the fields PATCH /officers/:id actually accepts -- departmentId and
 * hireDate are deliberately excluded, see the design doc §3. */
interface EditForm {
  firstName: string;
  lastName: string;
  badgeNumber: string;
  rank: string;
  employmentStatus: EmploymentStatus;
  postCertificationId: string;
  photoUrl: string;
}

function toEditForm(detail: InternalOfficerDetail): EditForm {
  return {
    firstName: detail.firstName,
    lastName: detail.lastName,
    badgeNumber: detail.badgeNumber ?? "",
    rank: detail.rank ?? "",
    employmentStatus: detail.employmentStatus,
    postCertificationId: detail.postCertificationId ?? "",
    photoUrl: detail.photoUrl ?? "",
  };
}

export function OfficerDetailPage() {
  const { id = "" } = useParams();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    api
      .fetchOfficerDetail(id)
      .then((detail) => {
        if (!cancelled) setState({ status: "ready", detail });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof ApiError ? err.message : "Failed to load this officer.";
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function startEditing(detail: InternalOfficerDetail) {
    setForm(toEditForm(detail));
    setSaveError(null);
    setEditing(true);
  }

  async function handleSave() {
    if (state.status !== "ready" || !form) return;
    setSaving(true);
    setSaveError(null);
    try {
      const original = toEditForm(state.detail);
      const diff: Record<string, unknown> = {};
      if (form.firstName !== original.firstName) diff.firstName = form.firstName.trim();
      if (form.lastName !== original.lastName) diff.lastName = form.lastName.trim();
      if (form.badgeNumber !== original.badgeNumber) diff.badgeNumber = form.badgeNumber.trim() || null;
      if (form.rank !== original.rank) diff.rank = form.rank.trim() || null;
      if (form.employmentStatus !== original.employmentStatus) diff.employmentStatus = form.employmentStatus;
      if (form.postCertificationId !== original.postCertificationId) diff.postCertificationId = form.postCertificationId.trim() || null;
      if (form.photoUrl !== original.photoUrl) diff.photoUrl = form.photoUrl.trim() || null;

      if (Object.keys(diff).length > 0) {
        await api.updateOfficer(id, diff);
        const refreshed = await api.fetchOfficerDetail(id);
        setState({ status: "ready", detail: refreshed });
      }
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  if (state.status === "loading") {
    return <p className="loading-state">Loading officer…</p>;
  }
  if (state.status === "error") {
    return (
      <div className="error-state" role="alert">
        {state.message}
      </div>
    );
  }

  const { detail } = state;

  return (
    <div>
      <h1 className="page-title">
        {detail.firstName} {detail.lastName}
      </h1>
      <p className="page-subtitle">{detail.departmentName}</p>

      {!editing && (
        <button type="button" className="btn btn-secondary" onClick={() => startEditing(detail)}>
          Edit
        </button>
      )}

      {saveError && <ErrorBanner message={saveError} />}

      {!editing && (
        <dl className="kv-grid">
          <dt>Badge #</dt>
          <dd>{detail.badgeNumber ?? "—"}</dd>
          <dt>Rank</dt>
          <dd>{detail.rank ?? "—"}</dd>
          <dt>Employment status</dt>
          <dd>{detail.employmentStatus}</dd>
          <dt>POST/certification ID</dt>
          <dd>{detail.postCertificationId ?? "—"}</dd>
          <dt>Hire date</dt>
          <dd>{detail.hireDate ?? "—"}</dd>
          <dt>Incidents on file</dt>
          <dd>{detail.incidentCount}</dd>
          <dt>Outcomes on file</dt>
          <dd>{detail.outcomeCount}</dd>
        </dl>
      )}

      {editing && form && (
        <div className="card stack">
          <div className="field-row">
            <div className="field">
              <label htmlFor="edit-first-name">First name</label>
              <input
                id="edit-first-name"
                type="text"
                value={form.firstName}
                onChange={(e) => setForm((f) => (f ? { ...f, firstName: e.target.value } : f))}
                disabled={saving}
              />
            </div>
            <div className="field">
              <label htmlFor="edit-last-name">Last name</label>
              <input
                id="edit-last-name"
                type="text"
                value={form.lastName}
                onChange={(e) => setForm((f) => (f ? { ...f, lastName: e.target.value } : f))}
                disabled={saving}
              />
            </div>
          </div>

          <div className="field">
            <span className="field-label-static">Department</span>
            <div>{detail.departmentName}</div>
            <span className="field-hint">
              Changing department requires the transfer officer action (not built yet) so employment history stays
              accurate — not editable here.
            </span>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="edit-badge">Badge number</label>
              <input
                id="edit-badge"
                type="text"
                value={form.badgeNumber}
                onChange={(e) => setForm((f) => (f ? { ...f, badgeNumber: e.target.value } : f))}
                disabled={saving}
              />
            </div>
            <div className="field">
              <label htmlFor="edit-rank">Rank</label>
              <input
                id="edit-rank"
                type="text"
                value={form.rank}
                onChange={(e) => setForm((f) => (f ? { ...f, rank: e.target.value } : f))}
                disabled={saving}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="edit-status">Employment status</label>
            <select
              id="edit-status"
              value={form.employmentStatus}
              onChange={(e) => setForm((f) => (f ? { ...f, employmentStatus: e.target.value as EmploymentStatus } : f))}
              disabled={saving}
            >
              {EMPLOYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="edit-post-id">POST/certification ID</label>
            <input
              id="edit-post-id"
              type="text"
              value={form.postCertificationId}
              onChange={(e) => setForm((f) => (f ? { ...f, postCertificationId: e.target.value } : f))}
              disabled={saving}
            />
          </div>

          <div className="field">
            <label htmlFor="edit-photo">Photo URL</label>
            <input
              id="edit-photo"
              type="url"
              value={form.photoUrl}
              onChange={(e) => setForm((f) => (f ? { ...f, photoUrl: e.target.value } : f))}
              disabled={saving}
            />
            <span className="field-hint">Changing this clears the existing photo confirmation — a reviewer will need to re-confirm it.</span>
          </div>

          <div className="card-actions">
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {detail.departmentHistory.length > 0 && (
        <section className="page-section">
          <h2>Department history</h2>
          <ul className="history-list">
            {detail.departmentHistory.map((h, i) => (
              <li key={i} className="history-item">
                <div className="history-item__dept">
                  {h.departmentName} — badge {h.badgeNumber ?? "unknown"}
                </div>
                <div className="history-item__meta">
                  {h.startDate} – {h.endDate ?? "present"}
                  {h.separationReason ? ` · ${h.separationReason}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire the route**

In `apps/admin/src/App.tsx`, find:

```tsx
import { PhotoReviewPage } from "./pages/PhotoReviewPage";
```

Replace with:

```tsx
import { PhotoReviewPage } from "./pages/PhotoReviewPage";
import { OfficerDetailPage } from "./pages/OfficerDetailPage";
```

Then find:

```tsx
      <Route
        path="/reviewers"
```

Insert immediately before it:

```tsx
      <Route
        path="/officers/:id"
        element={
          <RequireAuth>
            <OfficerDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/reviewers"
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run --workspace apps/admin test -- OfficerDetailPage`
Expected: PASS (3 tests).

- [ ] **Step 7: Run the full apps/admin suite to check for regressions**

Run: `npm run --workspace apps/admin test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/api/client.ts apps/admin/src/pages/OfficerDetailPage.tsx apps/admin/src/pages/__tests__/OfficerDetailPage.test.tsx apps/admin/src/App.tsx
git commit -m "Add OfficerDetailPage with view/edit at /officers/:id

First officer detail/edit page in the admin app. Only submits changed
fields to PATCH (a real partial update). departmentId is shown
read-only with a note explaining why -- see Task 1's backend rationale."
```

---

### Task 3: Discoverability — search page, picker link, review-queue link

**Files:**
- Create: `apps/admin/src/pages/OfficersPage.tsx`
- Create: `apps/admin/src/pages/__tests__/OfficersPage.test.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/components/Layout.tsx`
- Modify: `apps/admin/src/components/OfficerSearchPicker.tsx`
- Modify: `apps/admin/src/components/ReviewQueueItemCard.tsx`

**Interfaces:**
- Consumes: `api.searchOfficers` (existing, unchanged) for the new search page; `OfficerDetailPage`'s route (`/officers/:id`, Task 2) as a link target only — no shared code with that page.
- Produces: nothing other tasks depend on — this is the last task in this plan.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/pages/__tests__/OfficersPage.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { OfficersPage } from "../OfficersPage";
import * as api from "../../api/client";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, searchOfficers: vi.fn() };
});

describe("OfficersPage", () => {
  it("searches and renders each result as a link to its detail page", async () => {
    vi.mocked(api.searchOfficers).mockResolvedValue({
      candidates: [
        {
          id: "00000000-0000-0000-0000-000000000012",
          firstName: "Robert",
          lastName: "Smith",
          departmentId: "00000000-0000-0000-0000-000000000001",
          departmentName: "Springfield Police Department (fictional)",
          badgeNumber: "303",
          activeDateRange: { start: "2019-06-01", end: null },
          photoUrl: null,
        },
      ],
    });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <OfficersPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByRole("textbox"), "Robert Smith");

    const link = await screen.findByRole("link", { name: /Robert Smith/ });
    expect(link).toHaveAttribute("href", "/officers/00000000-0000-0000-0000-000000000012");
  });

  it("shows a no-results message for a query that matches nothing", async () => {
    vi.mocked(api.searchOfficers).mockResolvedValue({ candidates: [] });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <OfficersPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByRole("textbox"), "Nobody Real");

    await waitFor(() => {
      expect(screen.getByText(/no matching officers/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run --workspace apps/admin test -- OfficersPage`
Expected: FAIL — `Cannot find module '../OfficersPage'`.

- [ ] **Step 3: Write the page**

Create `apps/admin/src/pages/OfficersPage.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { OfficerSearchCandidate } from "@cop/shared-types";
import * as api from "../api/client";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

/**
 * Standalone officer lookup page -- deliberately separate from
 * OfficerSearchPicker (components/OfficerSearchPicker.tsx), which is a
 * reusable picker whose results fire onSelect back into whatever form
 * embeds it (review-queue resolution, incident forms). This page's
 * results are real navigation links instead, since here "finding an
 * officer" IS the whole task, not a step inside a larger form.
 */
export function OfficersPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OfficerSearchCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (query.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    const thisRequest = ++requestId.current;
    const timer = setTimeout(async () => {
      try {
        const res = await api.searchOfficers(query.trim());
        if (requestId.current === thisRequest) {
          setResults(res.candidates);
          setError(null);
          setSearched(true);
        }
      } catch (err) {
        if (requestId.current === thisRequest) {
          setResults([]);
          setError(err instanceof Error ? err.message : "Officer search failed.");
        }
      } finally {
        if (requestId.current === thisRequest) {
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div>
      <h1 className="page-title">Officers</h1>
      <p className="page-subtitle">Search by name or badge number to view or edit an officer's record.</p>

      <div className="field">
        <label htmlFor="officers-search">Search</label>
        <input
          id="officers-search"
          type="text"
          value={query}
          placeholder="Start typing a name…"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading && <p className="loading-state">Searching…</p>}
      {!loading && error && (
        <div className="error-state" role="alert">
          {error}
        </div>
      )}
      {!loading && !error && searched && results.length === 0 && (
        <div className="empty-state">No matching officers.</div>
      )}

      {!loading && !error && results.length > 0 && (
        <ul className="officer-list">
          {results.map((c) => (
            <li key={c.id}>
              <Link to={`/officers/${encodeURIComponent(c.id)}`}>
                <span>
                  <strong>
                    {c.firstName} {c.lastName}
                  </strong>
                  <div className="candidate-card__detail">
                    {c.departmentName} · {c.badgeNumber ? `badge #${c.badgeNumber}` : "no badge on file"}
                  </div>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire the route and nav link**

In `apps/admin/src/App.tsx`, find:

```tsx
import { OfficerDetailPage } from "./pages/OfficerDetailPage";
```

Replace with:

```tsx
import { OfficerDetailPage } from "./pages/OfficerDetailPage";
import { OfficersPage } from "./pages/OfficersPage";
```

Then find:

```tsx
      <Route
        path="/officers/:id"
        element={
          <RequireAuth>
            <OfficerDetailPage />
          </RequireAuth>
        }
      />
```

Replace with:

```tsx
      <Route
        path="/officers"
        element={
          <RequireAuth>
            <OfficersPage />
          </RequireAuth>
        }
      />
      <Route
        path="/officers/:id"
        element={
          <RequireAuth>
            <OfficerDetailPage />
          </RequireAuth>
        }
      />
```

In `apps/admin/src/components/Layout.tsx`, find:

```tsx
            <NavLink to="/photo-review" className={({ isActive }) => (isActive ? "active" : "")}>
              Photo Review
            </NavLink>
```

Insert immediately after it:

```tsx
            <NavLink to="/officers" className={({ isActive }) => (isActive ? "active" : "")}>
              Officers
            </NavLink>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run --workspace apps/admin test -- OfficersPage`
Expected: PASS (2 tests).

- [ ] **Step 6: Add the selected-chip link in `OfficerSearchPicker`**

In `apps/admin/src/components/OfficerSearchPicker.tsx`, find the import block:

```tsx
import { useEffect, useRef, useState } from "react";
import type { OfficerSearchCandidate } from "@cop/shared-types";
import * as api from "../api/client";
```

Replace with:

```tsx
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { OfficerSearchCandidate } from "@cop/shared-types";
import * as api from "../api/client";
```

Then find the selected-chip render block:

```tsx
        <div className="officer-chip" data-testid={`${id}-selected`}>
          <div>
            <div className="officer-chip-name">
              {selected.firstName} {selected.lastName}
            </div>
            <div className="officer-chip-meta">
              {selected.departmentName} · {selected.badgeNumber ? `badge #${selected.badgeNumber}` : "no badge on file"} ·{" "}
              active {formatActiveRange(selected)}
            </div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleChange} disabled={disabled}>
            Change
          </button>
        </div>
```

Replace with:

```tsx
        <div className="officer-chip" data-testid={`${id}-selected`}>
          <div>
            <div className="officer-chip-name">
              {selected.firstName} {selected.lastName}
            </div>
            <div className="officer-chip-meta">
              {selected.departmentName} · {selected.badgeNumber ? `badge #${selected.badgeNumber}` : "no badge on file"} ·{" "}
              active {formatActiveRange(selected)} ·{" "}
              <Link to={`/officers/${encodeURIComponent(selected.id)}`}>View full record</Link>
            </div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleChange} disabled={disabled}>
            Change
          </button>
        </div>
```

This only changes rendering after a pick is already complete (the `onSelect` callback already fired) — it does not touch the dropdown's pick buttons or the `onSelect`/`onClear` contract at all, so every existing caller (review-queue resolution, incident forms) keeps working unchanged.

- [ ] **Step 7: Update `OfficerSearchPicker.test.tsx` — every existing render needs a Router wrapper now**

`apps/admin/src/components/__tests__/OfficerSearchPicker.test.tsx` already
exists with 4 tests, none of which wrap `render(...)` in a Router. Since
the component now renders a `<Link>` (react-router throws if a `<Link>`
renders outside a Router context), **all four existing tests will fail
after Step 6's change**, not just need one new test added. Fix by wrapping
every render call and adding a fifth test for the new link.

Replace the full contents of `apps/admin/src/components/__tests__/OfficerSearchPicker.test.tsx` with:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { OfficerSearchPicker } from "../OfficerSearchPicker";
import { officerSearchFixtures } from "../../fixtures/officers";
import * as api from "../../api/client";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return {
    ...actual,
    searchOfficers: vi.fn(),
  };
});

describe("OfficerSearchPicker", () => {
  beforeEach(() => {
    vi.mocked(api.searchOfficers).mockResolvedValue({ candidates: officerSearchFixtures });
  });

  it("does not search until at least 2 characters are typed", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <OfficerSearchPicker id="picker" label="Search" onSelect={vi.fn()} />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Search"), "A");
    await new Promise((r) => setTimeout(r, 350));
    expect(api.searchOfficers).not.toHaveBeenCalled();
  });

  it("debounces and shows matching candidates, calling onSelect when one is picked (single mode)", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <MemoryRouter>
        <OfficerSearchPicker id="picker" label="Search" mode="single" onSelect={onSelect} />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Search"), "Alvar");
    await waitFor(() => expect(api.searchOfficers).toHaveBeenCalledWith("Alvar"));

    const option = await screen.findByRole("option", { name: /R\. Alvarez/ });
    await user.click(option);

    expect(onSelect).toHaveBeenCalledWith(officerSearchFixtures[0]);
    expect(await screen.findByTestId("picker-selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
  });

  it("in multi mode, resets back to an empty search box after each pick instead of showing a persistent chip", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <MemoryRouter>
        <OfficerSearchPicker id="picker" label="Search" mode="multi" onSelect={onSelect} />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Search"), "Alvar");
    const option = await screen.findByRole("option", { name: /R\. Alvarez/ });
    await user.click(option);

    expect(onSelect).toHaveBeenCalledWith(officerSearchFixtures[0]);
    expect(screen.queryByTestId("picker-selected")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Search")).toHaveValue("");
  });

  it("shows a no-matches message when the search returns nothing", async () => {
    vi.mocked(api.searchOfficers).mockResolvedValueOnce({ candidates: [] });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <OfficerSearchPicker id="picker" label="Search" onSelect={vi.fn()} />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Search"), "Zzzz");
    expect(await screen.findByText("No matching officers.")).toBeInTheDocument();
  });

  it("the selected chip links to the officer's detail page", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <OfficerSearchPicker id="picker" label="Search" mode="single" onSelect={vi.fn()} />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Search"), "Alvar");
    const option = await screen.findByRole("option", { name: /R\. Alvarez/ });
    await user.click(option);

    const link = await screen.findByRole("link", { name: /view full record/i });
    expect(link).toHaveAttribute("href", "/officers/off-204");
  });
});
```

Run: `npm run --workspace apps/admin test -- OfficerSearchPicker`
Expected: PASS (5 tests).

- [ ] **Step 8: Add the link in `ReviewQueueItemCard`**

`ReviewQueueItemCard.tsx` has two places rendering a raw `officerId`, but
they're not equivalent — only one is safe to linkify:

- `renderTitle` (line 215-221) returns a plain `string`, and that return
  value feeds an `aria-label` string template at line 109
  (`` aria-label={`Select ${renderTitle(rec)} for bulk approve`} ``) in
  addition to JSX at line 114. An `aria-label` must be plain text — a
  `<Link>` embedded in it would make no sense to a screen reader and can't
  even be expressed as a string. **Leave `renderTitle` and its
  `` `officer ${rec.officerId}` `` fallback (line 219) completely
  unchanged.**
- `renderDetails` (line 241-256ish) already returns JSX rendered inside a
  `<dl>` — line 248 is the one safe, real target.

In `apps/admin/src/components/ReviewQueueItemCard.tsx`, find:

```tsx
import { useState } from "react";
import type { OfficerSearchCandidate, ReviewQueueItem } from "@cop/shared-types";
import { OfficerSearchPicker } from "./OfficerSearchPicker";
```

Replace with:

```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import type { OfficerSearchCandidate, ReviewQueueItem } from "@cop/shared-types";
import { OfficerSearchPicker } from "./OfficerSearchPicker";
```

Then find:

```tsx
      <dt>Officer match</dt>
      <dd>{rec.officerId ? `matched (${rec.officerId})` : rec.officerName ? `${rec.officerName} (unmatched)` : "unmatched"}</dd>
```

Replace with:

```tsx
      <dt>Officer match</dt>
      <dd>
        {rec.officerId ? (
          <>
            matched (<Link to={`/officers/${encodeURIComponent(rec.officerId)}`}>{rec.officerId}</Link>)
          </>
        ) : rec.officerName ? (
          `${rec.officerName} (unmatched)`
        ) : (
          "unmatched"
        )}
      </dd>
```

- [ ] **Step 8b: Update `ReviewQueueItemCard.test.tsx` — same Router problem, 7 call sites**

`apps/admin/src/components/__tests__/ReviewQueueItemCard.test.tsx` has 7
`render(<ReviewQueueItemCard .../>)` calls, none wrapped in a Router. Step
8's `<Link>` addition breaks all 7 the same way Step 6 broke
`OfficerSearchPicker.test.tsx`'s 4. Fix using React Testing Library's
built-in `wrapper` render option (cleaner than repeating `<MemoryRouter>`
JSX at every call site since every call already passes an options-less
single argument to `render`):

Replace the full contents of `apps/admin/src/components/__tests__/ReviewQueueItemCard.test.tsx` with:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ReviewQueueItemCard } from "../ReviewQueueItemCard";
import { reviewQueueFixtures } from "../../fixtures/reviewQueue";
import { officerSearchFixtures } from "../../fixtures/officers";
import * as api from "../../api/client";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return {
    ...actual,
    searchOfficers: vi.fn(),
  };
});

function renderCard(ui: Parameters<typeof render>[0]) {
  return render(ui, { wrapper: MemoryRouter });
}

describe("ReviewQueueItemCard", () => {
  beforeEach(() => {
    vi.mocked(api.searchOfficers).mockResolvedValue({ candidates: officerSearchFixtures });
  });

  it("renders an officer_candidate proposal with its source and confidence", () => {
    const item = reviewQueueFixtures[0]; // officer_candidate, high confidence, tier2 source
    renderCard(<ReviewQueueItemCard item={item} onApprove={vi.fn()} onReject={vi.fn()} />);

    expect(screen.getByText(/Jordan Michaels/)).toBeInTheDocument();
    expect(screen.getByText(/Riverdale Police Department/)).toBeInTheDocument();
    expect(screen.getByText("4417")).toBeInTheDocument();
    expect(screen.getByText("CA-POST-88213")).toBeInTheDocument();
    expect(screen.getByText(/match: high/)).toBeInTheDocument();
    expect(screen.getByText(/Tier 2/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /post\.ca\.gov/ })).toHaveAttribute(
      "href",
      item.source!.url,
    );
  });

  it("renders an incident_candidate proposal that is already matched to an officer, with no officer picker required", () => {
    const item = reviewQueueFixtures[1]; // incident_candidate with officerId set
    renderCard(<ReviewQueueItemCard item={item} onApprove={vi.fn()} onReject={vi.fn()} />);

    expect(screen.getByText(/DA's office declined to prosecute/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Search for the officer/)).not.toBeInTheDocument();
  });

  it("renders 'No source attached' when source is null", () => {
    const item = reviewQueueFixtures.find((i) => i.source === null)!;
    renderCard(<ReviewQueueItemCard item={item} onApprove={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText("No source attached.")).toBeInTheDocument();
  });

  it("requires an officer to be searched-and-selected before allowing approve on an unmatched incident_candidate", async () => {
    const user = userEvent.setup();
    const item = reviewQueueFixtures[2]; // incident_candidate, officerName only, no officerId
    const onApprove = vi.fn().mockResolvedValue(undefined);
    renderCard(<ReviewQueueItemCard item={item} onApprove={onApprove} onReject={vi.fn()} />);

    const search = screen.getByLabelText(/Search for the officer/);
    expect(search).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.getByText(/Search for and select the officer before approving/)).toBeInTheDocument();

    await user.type(search, "Alvar");
    await waitFor(() => expect(api.searchOfficers).toHaveBeenCalledWith("Alvar"));
    const candidate = await screen.findByRole("option", { name: /R\. Alvarez/ });
    await user.click(candidate);

    expect(await screen.findByTestId(`officer-picker-${item.id}-selected`)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(onApprove).toHaveBeenCalledWith(item.id, { officerId: officerSearchFixtures[0].id });
  });

  it("calls onApprove with no edits for an officer_candidate", async () => {
    const user = userEvent.setup();
    const item = reviewQueueFixtures[0];
    const onApprove = vi.fn().mockResolvedValue(undefined);
    renderCard(<ReviewQueueItemCard item={item} onApprove={onApprove} onReject={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).toHaveBeenCalledWith(item.id, undefined);
  });

  it("requires a reason before submitting a rejection, then calls onReject", async () => {
    const user = userEvent.setup();
    const item = reviewQueueFixtures[0];
    const onReject = vi.fn().mockResolvedValue(undefined);
    renderCard(<ReviewQueueItemCard item={item} onApprove={vi.fn()} onReject={onReject} />);

    await user.click(screen.getByRole("button", { name: "Reject" }));
    const confirmBtn = screen.getByRole("button", { name: "Confirm reject" });
    await user.click(confirmBtn);
    expect(onReject).not.toHaveBeenCalled();
    expect(screen.getByText(/A short reason is required/)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Reason for rejection"), "Duplicate of an existing record");
    await user.click(screen.getByRole("button", { name: "Confirm reject" }));

    expect(onReject).toHaveBeenCalledWith(item.id, "Duplicate of an existing record");
  });

  it("surfaces an API error message inline when approve rejects", async () => {
    const user = userEvent.setup();
    const item = reviewQueueFixtures[0];
    const onApprove = vi.fn().mockRejectedValue(new Error("approval failed: department not found"));
    renderCard(<ReviewQueueItemCard item={item} onApprove={onApprove} onReject={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText(/approval failed: department not found/)).toBeInTheDocument();
  });
});
```

Run: `npm run --workspace apps/admin test -- ReviewQueueItemCard`
Expected: PASS (7 tests, all still asserting exactly what they did before —
only the render call and import changed).

- [ ] **Step 9: Run the full apps/admin suite to check for regressions**

Run: `npm run --workspace apps/admin test`
Expected: PASS — including `ReviewQueueItemCard`'s existing tests, which should still find the officer id text present (now inside a link rather than plain text) if any test asserts on that text content.

- [ ] **Step 10: Commit**

```bash
git add apps/admin/src/pages/OfficersPage.tsx apps/admin/src/pages/__tests__/OfficersPage.test.tsx apps/admin/src/App.tsx apps/admin/src/components/Layout.tsx apps/admin/src/components/OfficerSearchPicker.tsx apps/admin/src/components/__tests__/OfficerSearchPicker.test.tsx apps/admin/src/components/ReviewQueueItemCard.tsx apps/admin/src/components/__tests__/ReviewQueueItemCard.test.tsx
git commit -m "Add officer lookup page and link officers from existing views

New /officers search page is the real discovery entry point (added to
primary nav) -- OfficerSearchPicker's dropdown stays picker-only
(results still fire onSelect, never navigate) per the design doc's
correction; only its already-completed selected-chip state gets a
'View full record' link. ReviewQueueItemCard's incidental raw-officerId
text becomes a link too."
```
