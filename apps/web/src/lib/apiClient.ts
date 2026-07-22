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
  GetDepartmentStatsResponse,
  GetOfficerResponse,
  ListDepartmentsResponse,
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

/** Request body for POST /api/public/disputes — mirrors the shared Dispute
 * fields the API accepts on create (id/status/etc are server-assigned). */
export interface SubmitDisputeRequest {
  incidentId?: string;
  outcomeId?: string;
  officerId?: string;
  requesterName: string;
  requesterRole: "officer" | "department" | "attorney" | "subject" | "other";
  claim: string;
  evidenceUrl?: string;
}

/** POST /api/public/disputes */
export function submitDispute(body: SubmitDisputeRequest): Promise<void> {
  return request<void>("/api/public/disputes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
