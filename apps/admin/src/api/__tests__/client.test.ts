import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as api from "../client";
import { ApiError } from "../client";

/** Minimal Response stand-in — request() only ever calls .json() (error path)
 * or .text() (success path) on what fetch() resolves to. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function emptyResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error("no body");
    },
    text: async () => "",
  } as unknown as Response;
}

describe("api/client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    api.setToken(null);
    api.setUnauthorizedHandler(null);
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("token handling", () => {
    it("attaches an Authorization: Bearer <token> header when a token is set", async () => {
      api.setToken("tok-xyz");
      fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));

      await api.fetchReviewQueue();

      const [, options] = fetchMock.mock.calls[0];
      expect(options.headers.Authorization).toBe("Bearer tok-xyz");
    });

    it("omits the Authorization header when no token is set", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));

      await api.fetchReviewQueue();

      const [, options] = fetchMock.mock.calls[0];
      expect(options.headers.Authorization).toBeUndefined();
    });

    it("login always skips auth, even if a token happens to be set", async () => {
      api.setToken("stale-token");
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          token: "tok-1",
          expiresAt: "2026-01-01T00:00:00.000Z",
          reviewer: { id: "rev-1", name: "Admin Reviewer", email: "reviewer@example.org", role: "admin", active: true },
        }),
      );

      await api.login({ email: "reviewer@example.org", password: "hunter2" });

      const [, options] = fetchMock.mock.calls[0];
      expect(options.headers.Authorization).toBeUndefined();
    });

    it("persists the token to sessionStorage and getToken() reflects it", () => {
      api.setToken("tok-persisted");
      expect(sessionStorage.getItem("cop_admin_token")).toBe("tok-persisted");
      expect(api.getToken()).toBe("tok-persisted");

      api.setToken(null);
      expect(sessionStorage.getItem("cop_admin_token")).toBeNull();
      expect(api.getToken()).toBeNull();
    });
  });

  describe("request URL/method/body shape per endpoint", () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(jsonResponse(200, {}));
    });

    it("login: POST /api/internal/auth/login with the credentials as the body", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          token: "tok-1",
          expiresAt: "2026-01-01T00:00:00.000Z",
          reviewer: { id: "rev-1", name: "Admin Reviewer", email: "reviewer@example.org", role: "admin", active: true },
        }),
      );
      await api.login({ email: "a@b.com", password: "pw" });
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/auth/login",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "a@b.com", password: "pw" }) }),
      );
    });

    it("fetchReviewQueue: GET with a status query param, defaulting to pending", async () => {
      await api.fetchReviewQueue();
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/review-queue?status=pending",
        expect.objectContaining({ method: "GET" }),
      );

      await api.fetchReviewQueue("approved");
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/review-queue?status=approved",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("approveReviewQueueItem: POST to the item's approve sub-path with edits as the body", async () => {
      await api.approveReviewQueueItem("rq-1", { edits: { note: "ok" } });
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/review-queue/rq-1/approve",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ edits: { note: "ok" } }) }),
      );
    });

    it("rejectReviewQueueItem: POST to the item's reject sub-path", async () => {
      await api.rejectReviewQueueItem("rq-2", { reason: "duplicate" });
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/review-queue/rq-2/reject",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ reason: "duplicate" }) }),
      );
    });

    it("fetchDisputes: GET with a status query param, defaulting to open", async () => {
      await api.fetchDisputes();
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/disputes?status=open",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("resolveDispute: POST to the dispute's resolve sub-path", async () => {
      await api.resolveDispute("dp-2", { status: "resolved_no_change", resolutionNotes: "confirmed" });
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/disputes/dp-2/resolve",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ status: "resolved_no_change", resolutionNotes: "confirmed" }),
        }),
      );
    });

    it("searchOfficers: GET with the query string encoded", async () => {
      await api.searchOfficers("R. Alvarez");
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/officers/search?q=R.%20Alvarez",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("fetchReviewDigest: GET the digest endpoint", async () => {
      await api.fetchReviewDigest();
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/review-queue/digest",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("bulkApproveReviewQueueItems: POST with the ids array as the body", async () => {
      await api.bulkApproveReviewQueueItems({ reviewQueueIds: ["rq-1", "rq-2"] });
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/review-queue/bulk-approve",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ reviewQueueIds: ["rq-1", "rq-2"] }) }),
      );
    });

    it("fetchReviewers: GET the reviewers list", async () => {
      await api.fetchReviewers();
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/reviewers",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("createReviewer: POST with the new-reviewer payload", async () => {
      const payload = { name: "New Person", email: "new@example.org", role: "reviewer" as const, password: "supersecret1" };
      await api.createReviewer(payload);
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/reviewers",
        expect.objectContaining({ method: "POST", body: JSON.stringify(payload) }),
      );
    });

    it("updateReviewer: PATCH to the reviewer's own path", async () => {
      await api.updateReviewer("rev-2", { active: false });
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/reviewers/rev-2",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ active: false }) }),
      );
    });

    it("fetchRecordRevisions: GET with no query string when no params are given", async () => {
      await api.fetchRecordRevisions();
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/record-revisions",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("fetchRecordRevisions: GET with recordType/page/pageSize encoded as query params", async () => {
      await api.fetchRecordRevisions({ recordType: "incident", page: 2, pageSize: 10 });
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/record-revisions?recordType=incident&page=2&pageSize=10",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("createDepartment: POST to /api/internal/departments", async () => {
      const payload = { name: "Riverdale PD", state: "CA", jurisdictionType: "municipal" };
      await api.createDepartment(payload);
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/departments",
        expect.objectContaining({ method: "POST", body: JSON.stringify(payload) }),
      );
    });

    it("createOfficer: POST to /api/internal/officers", async () => {
      const payload = { firstName: "Jordan", lastName: "Lee", departmentId: "dept-1" };
      await api.createOfficer(payload);
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/officers",
        expect.objectContaining({ method: "POST", body: JSON.stringify(payload) }),
      );
    });

    it("createSource: POST to /api/internal/sources", async () => {
      const payload = { sourceType: "news_article" as const, url: "https://example.org/a", reliabilityTier: "tier3_established_news" as const };
      await api.createSource(payload);
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/sources",
        expect.objectContaining({ method: "POST", body: JSON.stringify(payload) }),
      );
    });

    it("createIncident: POST to /api/internal/incidents", async () => {
      const payload = {
        departmentId: "dept-1",
        date: "2025-01-01",
        incidentType: "use_of_force" as const,
        shortDescription: "desc",
        officerIds: ["off-1"],
      };
      await api.createIncident(payload);
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/incidents",
        expect.objectContaining({ method: "POST", body: JSON.stringify(payload) }),
      );
    });

    it("createOutcome: POST to /api/internal/outcomes", async () => {
      const payload = { incidentId: "inc-1", outcomeType: "internal_discipline" as const };
      await api.createOutcome(payload);
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/outcomes",
        expect.objectContaining({ method: "POST", body: JSON.stringify(payload) }),
      );
    });

    it("createCitation: POST to /api/internal/citations", async () => {
      const payload = { sourceId: "src-1", citableType: "incident" as const, citableId: "inc-1" };
      await api.createCitation(payload);
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4002/api/internal/citations",
        expect.objectContaining({ method: "POST", body: JSON.stringify(payload) }),
      );
    });
  });

  describe("error handling", () => {
    it("surfaces a non-2xx response as an ApiError exposing the parsed {error, message}", async () => {
      fetchMock.mockResolvedValue(jsonResponse(403, { error: "forbidden", message: "Admins only." }));

      await expect(api.fetchReviewers()).rejects.toMatchObject({
        status: 403,
        body: { error: "forbidden", message: "Admins only." },
        message: "Admins only.",
      });
      await expect(api.fetchReviewers()).rejects.toBeInstanceOf(ApiError);
    });

    it("falls back to a generic message when the error response has no JSON body", async () => {
      fetchMock.mockResolvedValue(emptyResponse(500));

      await expect(api.fetchReviewers()).rejects.toMatchObject({
        status: 500,
        body: null,
        message: "Request failed with status 500",
      });
    });

    it("calls the registered unauthorized handler on a 401 response, and still rejects", async () => {
      const handler = vi.fn();
      api.setUnauthorizedHandler(handler);
      fetchMock.mockResolvedValue(jsonResponse(401, { error: "unauthorized", message: "Token expired." }));

      await expect(api.fetchReviewers()).rejects.toBeInstanceOf(ApiError);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("does not call the unauthorized handler for a successful or a non-401 error response", async () => {
      const handler = vi.fn();
      api.setUnauthorizedHandler(handler);

      fetchMock.mockResolvedValueOnce(jsonResponse(200, { reviewers: [] }));
      await api.fetchReviewers();
      fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: "forbidden", message: "Admins only." }));
      await expect(api.fetchReviewers()).rejects.toBeInstanceOf(ApiError);

      expect(handler).not.toHaveBeenCalled();
    });

    it("wraps a network failure (fetch rejecting) in an ApiError with status 0", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(api.fetchReviewers()).rejects.toMatchObject({ status: 0 });
      await expect(api.fetchReviewers()).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe("response body handling", () => {
    it("returns undefined for a 204 No Content response without reading a body", async () => {
      fetchMock.mockResolvedValue(emptyResponse(204));
      const result = await api.approveReviewQueueItem("rq-1");
      expect(result).toBeUndefined();
    });

    it("returns undefined for a 200 response with an empty body", async () => {
      fetchMock.mockResolvedValue(emptyResponse(200));
      const result = await api.rejectReviewQueueItem("rq-1", { reason: "x" });
      expect(result).toBeUndefined();
    });

    it("parses and returns a JSON body on success", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { reviewers: [{ id: "rev-1" }] }));
      const result = await api.fetchReviewers();
      expect(result).toEqual({ reviewers: [{ id: "rev-1" }] });
    });
  });
});
