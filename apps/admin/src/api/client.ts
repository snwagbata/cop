/**
 * Single place every HTTP call to the internal API goes through.
 *
 * Keeping this as one module (rather than scattering fetch() calls across
 * pages) means: one spot to change the base URL / auth header behavior, one
 * spot that defines what "logged out" means, and one spot to point at fixture
 * data instead of the network while the internal API is being built out
 * concurrently (see apps/admin/README.md).
 */
import type {
  ApiErrorResponse,
  ApproveReviewQueueItemRequest,
  BulkApproveRequest,
  BulkApproveResponse,
  CreateCitationRequest,
  CreateDepartmentRequest,
  CreateIncidentRequest,
  CreateOfficerRequest,
  CreateOutcomeRequest,
  CreateRecordResponse,
  CreateReviewerRequest,
  CreateSourceRequest,
  Department,
  Dispute,
  DisputeStatus,
  GetReviewDigestResponse,
  ListDisputesResponse,
  ListRecordRevisionsResponse,
  ListReviewersResponse,
  ListReviewQueueResponse,
  LoginRequest,
  LoginResponse,
  Reviewer,
  RejectReviewQueueItemRequest,
  ResolveDisputeRequest,
  ReviewQueueItem,
  ReviewQueueStatus,
  SearchInternalOfficersResponse,
  UpdateReviewerRequest,
} from "@cop/shared-types";

const DEFAULT_BASE_URL = "http://localhost:4002";

function getBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL;
  const base = configured && configured.length > 0 ? configured : DEFAULT_BASE_URL;
  return base.replace(/\/$/, "");
}

/**
 * Thrown for any non-2xx response. Carries the parsed ApiErrorResponse when
 * the server sent one, so callers can show `message` (or `error`) instead of
 * a generic "request failed" string.
 */
export class ApiError extends Error {
  status: number;
  body: ApiErrorResponse | null;

  constructor(status: number, body: ApiErrorResponse | null, fallbackMessage: string) {
    super(body?.message ?? body?.error ?? fallbackMessage);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

const TOKEN_STORAGE_KEY = "cop_admin_token";

// In-memory token, mirrored to sessionStorage so a page reload during a
// reviewer's session doesn't force a re-login. Per the task spec this is an
// MVP-acceptable storage choice, not a hardened auth store.
let currentToken: string | null = sessionStorage.getItem(TOKEN_STORAGE_KEY);

/** Called whenever a request comes back 401, so the app can drop back to /login. */
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export function setToken(token: string | null): void {
  currentToken = token;
  if (token) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export function getToken(): string | null {
  return currentToken;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Skip attaching the Authorization header (only login needs this). */
  skipAuth?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, skipAuth = false } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (!skipAuth && currentToken) {
    headers.Authorization = `Bearer ${currentToken}`;
  }

  let response: Response;
  try {
    response = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    throw new ApiError(
      0,
      null,
      `Could not reach the internal API at ${getBaseUrl()}. Is it running? (${
        networkErr instanceof Error ? networkErr.message : String(networkErr)
      })`,
    );
  }

  if (response.status === 401) {
    unauthorizedHandler?.();
  }

  if (!response.ok) {
    let parsedBody: ApiErrorResponse | null = null;
    try {
      parsedBody = (await response.json()) as ApiErrorResponse;
    } catch {
      // Body wasn't JSON (or was empty) — fall back to status text below.
    }
    throw new ApiError(response.status, parsedBody, `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

// ---------------------------------------------------------------------------
// Typed endpoint wrappers
// ---------------------------------------------------------------------------

export function login(payload: LoginRequest): Promise<LoginResponse> {
  return request<LoginResponse>("/api/internal/auth/login", {
    method: "POST",
    body: payload,
    skipAuth: true,
  });
}

export function fetchReviewQueue(status: ReviewQueueStatus = "pending"): Promise<ListReviewQueueResponse> {
  return request<ListReviewQueueResponse>(
    `/api/internal/review-queue?status=${encodeURIComponent(status)}`,
  );
}

export function approveReviewQueueItem(
  id: string,
  payload: ApproveReviewQueueItemRequest = {},
): Promise<ReviewQueueItem | undefined> {
  return request<ReviewQueueItem | undefined>(`/api/internal/review-queue/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    body: payload,
  });
}

export function rejectReviewQueueItem(
  id: string,
  payload: RejectReviewQueueItemRequest,
): Promise<ReviewQueueItem | undefined> {
  return request<ReviewQueueItem | undefined>(`/api/internal/review-queue/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    body: payload,
  });
}

export function fetchDisputes(status: DisputeStatus = "open"): Promise<ListDisputesResponse> {
  return request<ListDisputesResponse>(`/api/internal/disputes?status=${encodeURIComponent(status)}`);
}

export function resolveDispute(
  id: string,
  payload: ResolveDisputeRequest,
): Promise<Dispute | undefined> {
  return request<Dispute | undefined>(`/api/internal/disputes/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    body: payload,
  });
}

// ---------------------------------------------------------------------------
// Post-MVP additions
// ---------------------------------------------------------------------------

/** Debounced-search-and-select officer picker (ReviewQueueItemCard, manual entry). */
export function searchOfficers(q: string): Promise<SearchInternalOfficersResponse> {
  return request<SearchInternalOfficersResponse>(`/api/internal/officers/search?q=${encodeURIComponent(q)}`);
}

/** DESIGN.md §7 weekly digest, backs the post-login dashboard. */
export function fetchReviewDigest(): Promise<GetReviewDigestResponse> {
  return request<GetReviewDigestResponse>("/api/internal/review-queue/digest");
}

export function bulkApproveReviewQueueItems(payload: BulkApproveRequest): Promise<BulkApproveResponse> {
  return request<BulkApproveResponse>("/api/internal/review-queue/bulk-approve", {
    method: "POST",
    body: payload,
  });
}

export function fetchReviewers(): Promise<ListReviewersResponse> {
  return request<ListReviewersResponse>("/api/internal/reviewers");
}

export function createReviewer(payload: CreateReviewerRequest): Promise<Reviewer> {
  return request<Reviewer>("/api/internal/reviewers", { method: "POST", body: payload });
}

export function updateReviewer(id: string, payload: UpdateReviewerRequest): Promise<Reviewer> {
  return request<Reviewer>(`/api/internal/reviewers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: payload,
  });
}

export function fetchRecordRevisions(params: {
  recordType?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<ListRecordRevisionsResponse> {
  const qs = new URLSearchParams();
  if (params.recordType) qs.set("recordType", params.recordType);
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<ListRecordRevisionsResponse>(`/api/internal/record-revisions${suffix}`);
}

// --- Manual data-entry (DESIGN.md Phase 1 reviewer-authored entry) --------
//
// The created-record shapes here aren't spelled out precisely in
// shared-types beyond CreateRecordResponse<T>'s envelope, so T is modeled
// locally as "the request fields, plus the assigned id" -- the minimum any
// insert-and-return-the-row endpoint would plausibly send back. Adjust if
// the real internal API responds with a richer shape once it's up.

export interface CreatedDepartment extends CreateDepartmentRequest {
  id: string;
}
export interface CreatedOfficer extends CreateOfficerRequest {
  id: string;
}
export interface CreatedSource extends CreateSourceRequest {
  id: string;
}
export interface CreatedIncident extends CreateIncidentRequest {
  id: string;
}
export interface CreatedOutcome extends CreateOutcomeRequest {
  id: string;
}

export function createDepartment(
  payload: CreateDepartmentRequest,
): Promise<CreateRecordResponse<CreatedDepartment>> {
  return request("/api/internal/departments", { method: "POST", body: payload });
}

export function createOfficer(payload: CreateOfficerRequest): Promise<CreateRecordResponse<CreatedOfficer>> {
  return request("/api/internal/officers", { method: "POST", body: payload });
}

export function createSource(payload: CreateSourceRequest): Promise<CreateRecordResponse<CreatedSource>> {
  return request("/api/internal/sources", { method: "POST", body: payload });
}

export function createIncident(payload: CreateIncidentRequest): Promise<CreateRecordResponse<CreatedIncident>> {
  return request("/api/internal/incidents", { method: "POST", body: payload });
}

export function createOutcome(payload: CreateOutcomeRequest): Promise<CreateRecordResponse<CreatedOutcome>> {
  return request("/api/internal/outcomes", { method: "POST", body: payload });
}

export function createCitation(payload: CreateCitationRequest): Promise<CreateRecordResponse<CreateCitationRequest & { id: string }>> {
  return request("/api/internal/citations", { method: "POST", body: payload });
}

// Re-exported so pages don't need to import the Department model separately
// just to type a locally-cached "departments created this session" list.
export type { Department };
