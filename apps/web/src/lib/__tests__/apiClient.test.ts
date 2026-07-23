import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  ApiError,
  getDisputeStatus,
  getDepartmentStats,
  getOfficer,
  listDepartments,
  listOfficers,
  searchOfficers,
  submitDispute,
} from "../apiClient";
import { API_BASE_URL } from "../config";

function jsonResponse(body: unknown, init?: { status?: number }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("apiClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searchOfficers calls GET /api/public/officers/search with the query string", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ candidates: [] }));
    await searchOfficers("Reyes");
    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE_URL}/api/public/officers/search?q=Reyes`,
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }),
    );
  });

  it("getOfficer calls GET /api/public/officers/:id with the id URL-encoded", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ officer: {} }));
    await getOfficer("off/1 x");
    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE_URL}/api/public/officers/${encodeURIComponent("off/1 x")}`,
      expect.anything(),
    );
  });

  it("listDepartments calls GET /api/public/departments", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ departments: [] }));
    await listDepartments();
    expect(fetch).toHaveBeenCalledWith(`${API_BASE_URL}/api/public/departments`, expect.anything());
  });

  it("getDepartmentStats calls GET /api/public/departments/:id/stats", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ department: {}, stats: {} }));
    await getDepartmentStats("dept-1");
    expect(fetch).toHaveBeenCalledWith(`${API_BASE_URL}/api/public/departments/dept-1/stats`, expect.anything());
  });

  it("submitDispute POSTs to /api/public/disputes with a JSON body and Content-Type header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ dispute: {} }));
    const body = {
      officerId: "off-1",
      requesterName: "Jane Doe",
      requesterRole: "subject" as const,
      claim: "Wrong date",
    };
    await submitDispute(body);
    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE_URL}/api/public/disputes`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      }),
    );
  });

  it("getDisputeStatus calls GET /api/public/disputes/:id", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ id: "disp-1", status: "open" }));
    await getDisputeStatus("disp-1");
    expect(fetch).toHaveBeenCalledWith(`${API_BASE_URL}/api/public/disputes/disp-1`, expect.anything());
  });

  it("listOfficers builds the query string from departmentId/page/pageSize, omitting unset params", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ officers: [], pageInfo: {} }));
    await listOfficers({ departmentId: "dept-1", page: 2, pageSize: 20 });
    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE_URL}/api/public/officers?departmentId=dept-1&page=2&pageSize=20`,
      expect.anything(),
    );

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ officers: [], pageInfo: {} }));
    await listOfficers({});
    expect(fetch).toHaveBeenCalledWith(`${API_BASE_URL}/api/public/officers`, expect.anything());
  });

  it("surfaces a non-2xx JSON error body as an ApiError with status/error/message accessible to the caller", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: "not_found", message: "No officer record found for this ID." }, { status: 404 }),
    );

    await expect(getOfficer("nope")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      message: "No officer record found for this ID.",
      body: { error: "not_found", message: "No officer record found for this ID." },
    });
  });

  it("does not swallow a non-2xx response whose body isn't valid JSON — status still surfaces", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("<html>Bad gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } }),
    );

    let caught: unknown;
    try {
      await listDepartments();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(502);
    expect((caught as ApiError).body).toBeNull();
  });

  it("wraps a network-level fetch failure (fetch rejecting) in an ApiError rather than letting it propagate raw", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    let caught: unknown;
    try {
      await listDepartments();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(0);
    expect((caught as ApiError).message).toContain("Could not reach the API");
  });
});
