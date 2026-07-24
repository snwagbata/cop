/**
 * Single abstraction wrapping every call this app makes to the public API
 * (base path /api/public — see DESIGN.md §8 and packages/shared-types).
 *
 * Keeping every fetch call in one module means:
 *  - the base URL is configured in exactly one place (see config.ts)
 *  - response shapes are asserted against @cop/shared-types at the boundary
 *  - swapping in real data once the API is reachable (or repointing to a
 *    different environment) only touches this file, never the components
 *    that call it.
 */
import type {
  ApiErrorResponse,
  CreatePublicDisputeRequest,
  CreatePublicDisputeResponse,
  CreatePublicTipRequest,
  CreatePublicTipResponse,
  DisputeStatusResponse,
  GetDepartmentStatsResponse,
  GetOfficerResponse,
  ListDepartmentsResponse,
  ListOfficersResponse,
  SearchOfficersResponse,
} from "@cop/shared-types";
import { API_BASE_URL } from "./config";

export class ApiError extends Error {
  status: number;
  body: ApiErrorResponse | null;

  constructor(status: number, body: ApiErrorResponse | null, fallbackMessage: string) {
    super(body?.message ?? fallbackMessage);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Accept: "application/json", ...(init?.headers ?? {}) },
      ...init,
    });
  } catch (err) {
    throw new ApiError(0, null, `Could not reach the API at ${API_BASE_URL}. ${(err as Error).message}`);
  }

  if (!res.ok) {
    let body: ApiErrorResponse | null = null;
    try {
      body = (await res.json()) as ApiErrorResponse;
    } catch {
      // response body wasn't JSON — leave body null, status still surfaces
    }
    throw new ApiError(res.status, body, `Request to ${path} failed with status ${res.status}`);
  }

  return (await res.json()) as T;
}

/** GET /api/public/officers/search?q=<string> */
export function searchOfficers(query: string): Promise<SearchOfficersResponse> {
  const params = new URLSearchParams({ q: query });
  return request<SearchOfficersResponse>(`/api/public/officers/search?${params.toString()}`);
}

/** GET /api/public/officers/:id */
export function getOfficer(id: string): Promise<GetOfficerResponse> {
  return request<GetOfficerResponse>(`/api/public/officers/${encodeURIComponent(id)}`);
}

/** GET /api/public/departments */
export function listDepartments(): Promise<ListDepartmentsResponse> {
  return request<ListDepartmentsResponse>("/api/public/departments");
}

/** GET /api/public/departments/:id/stats */
export function getDepartmentStats(id: string): Promise<GetDepartmentStatsResponse> {
  return request<GetDepartmentStatsResponse>(`/api/public/departments/${encodeURIComponent(id)}/stats`);
}

/** POST /api/public/disputes — request/response shapes now formalized in
 * @cop/shared-types (CreatePublicDisputeRequest/Response) rather than a
 * locally-declared interface. */
export function submitDispute(body: CreatePublicDisputeRequest): Promise<CreatePublicDisputeResponse> {
  return request<CreatePublicDisputeResponse>("/api/public/disputes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * GET /api/public/disputes/:id — dispute status-check page (task item 3).
 * Deliberately returns only DisputeStatusResponse's narrow shape; see that
 * type's doc comment in shared-types for why (must not leak requesterName/
 * claim/evidenceUrl to anyone who merely has the id).
 */
export function getDisputeStatus(id: string): Promise<DisputeStatusResponse> {
  return request<DisputeStatusResponse>(`/api/public/disputes/${encodeURIComponent(id)}`);
}

/**
 * POST /api/public/tips — anonymous, source-protected tip intake (DESIGN.md
 * §12). Same request/response pattern as submitDispute above, but the
 * response is deliberately minimal ({ success: true }, no id) since there's
 * no follow-up or status-check surface for a tip — see
 * CreatePublicTipResponse's doc comment in @cop/shared-types.
 */
export function submitTip(body: CreatePublicTipRequest): Promise<CreatePublicTipResponse> {
  return request<CreatePublicTipResponse>("/api/public/tips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * GET /api/public/officers — browse/paginate endpoint (task item 5), distinct
 * from /officers/search's disambiguation-only contract. Used by the
 * department "browse officers" view.
 */
export function listOfficers(params: { departmentId?: string; page?: number; pageSize?: number }): Promise<ListOfficersResponse> {
  const query = new URLSearchParams();
  if (params.departmentId) query.set("departmentId", params.departmentId);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  const qs = query.toString();
  return request<ListOfficersResponse>(`/api/public/officers${qs ? `?${qs}` : ""}`);
}
