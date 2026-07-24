/**
 * Shared contract between the public API, internal API, public web app, and
 * admin app. This is the single source of truth for shapes crossing an
 * HTTP boundary in this repo — mirrors DESIGN.md v0.4 §4's data model, not
 * a 1:1 copy of the DB rows (dates are ISO strings over the wire, cent
 * amounts stay integer cents, etc).
 */

// ---------------------------------------------------------------------------
// Domain models
// ---------------------------------------------------------------------------

export type EmploymentStatus =
  | "active"
  | "inactive"
  | "terminated"
  | "resigned"
  | "retired"
  | "decertified";

export type IncidentType = "use_of_force" | "false_report" | "unlawful_arrest" | "other";

export type IncidentStatus =
  | "alleged"
  | "sustained"
  | "unsustained"
  | "exonerated"
  | "pending"
  | "disputed";

export type InvolvementRole = "primary" | "witness" | "named_defendant" | "other";

export type OutcomeType =
  | "internal_discipline"
  | "termination"
  | "DA_declination"
  | "lawsuit_settlement"
  | "lawsuit_dismissed"
  | "criminal_charges_officer"
  | "no_action";

export type SourceType =
  | "court_doc"
  | "news_article"
  | "public_records_response"
  | "official_dataset"
  | "decertification_registry";

export type ReliabilityTier =
  | "tier1_primary_legal_doc"
  | "tier2_official_dataset"
  | "tier3_established_news"
  | "tier4_submitted_unverified";

export type CitableType = "incident" | "outcome" | "officer";

export type MatchConfidence = "high" | "medium" | "low";

export type ReviewQueueStatus = "pending" | "approved" | "rejected" | "needs_more_info";

export type DisputeRequesterRole = "officer" | "department" | "attorney" | "subject" | "other";

export type DisputeStatus = "open" | "resolved_corrected" | "resolved_no_change" | "resolved_removed";

export interface Department {
  id: string;
  name: string;
  state: string;
  jurisdictionType: string;
  contactInfo: string | null;
  recordsRequestPortalUrl: string | null;
}

export interface DepartmentStats {
  departmentId: string;
  totalSettlementAmountCents: number;
  sustainedComplaintCount: number;
  totalIncidentCount: number;
  wanderingOfficerHireCount: number;
  lastComputedAt: string; // ISO timestamp
}

export interface OfficerDepartmentHistoryEntry {
  departmentId: string;
  departmentName: string;
  badgeNumber: string | null;
  startDate: string; // ISO date
  endDate: string | null; // ISO date, null = current
  separationReason: string | null;
}

export interface Source {
  id: string;
  sourceType: SourceType;
  url: string;
  publicationDate: string | null;
  retrievedDate: string;
  reliabilityTier: ReliabilityTier;
}

export interface Outcome {
  id: string;
  incidentId: string;
  outcomeType: OutcomeType;
  date: string | null;
  amountCents: number | null;
  currency: string;
  details: string | null;
  citations: Source[];
}

export interface IncidentOfficerRef {
  officerId: string;
  firstName: string;
  lastName: string;
  involvementRole: InvolvementRole;
}

export interface Incident {
  id: string;
  departmentId: string;
  date: string;
  incidentType: IncidentType;
  shortDescription: string;
  status: IncidentStatus;
  officers: IncidentOfficerRef[];
  outcomes: Outcome[];
  citations: Source[];
}

/**
 * A single disambiguation candidate returned by officer search. Rendering
 * this picker before revealing any incident/outcome data is mandatory
 * whenever more than one candidate is returned — DESIGN.md §2, §6. This is
 * the schema's direct mitigation for the project's stated #1 risk
 * (misidentification), so it's a UI *requirement*, not a UI suggestion.
 */
export interface OfficerSearchCandidate {
  id: string;
  firstName: string;
  lastName: string;
  departmentId: string;
  departmentName: string;
  badgeNumber: string | null;
  activeDateRange: { start: string; end: string | null };
  photoUrl: string | null;
}

/**
 * A resolved dispute's public-facing summary, surfaced inline on the record
 * it targets (DESIGN.md §12's "right-of-reply excerpt" backlog item — shown
 * on the page itself, not just logged in the internal disputes table).
 * Deliberately narrow: only what's needed to show the resolution in context,
 * not the full internal Dispute shape (requester identity stays internal).
 */
export interface ResolvedDisputeSummary {
  targetType: "incident" | "outcome" | "officer";
  targetId: string;
  status: Exclude<DisputeStatus, "open">;
  resolutionNotes: string;
  resolvedAt: string;
}

export interface OfficerDetail {
  id: string;
  firstName: string;
  lastName: string;
  knownAliases: string[];
  department: Department;
  badgeNumber: string | null;
  rank: string | null;
  employmentStatus: EmploymentStatus;
  photoUrl: string | null;
  departmentHistory: OfficerDepartmentHistoryEntry[];
  incidents: Incident[];
  /** Resolved disputes touching this officer or any of their incidents/outcomes. */
  resolvedDisputes: ResolvedDisputeSummary[];
  /**
   * Standard disclaimer block (DESIGN.md §3) — the API returns the copy so
   * the frontend never accidentally omits it. Not officer-specific content;
   * same text on every officer page.
   */
  disclaimer: string;
}

// ---------------------------------------------------------------------------
// Internal / review-queue models
// ---------------------------------------------------------------------------

/**
 * One officer with a photo_url awaiting the DESIGN.md §7 confirmation gate
 * ("photo_url is never auto-approved, even from a tier1 source -- a
 * reviewer must positively confirm the photo matches the officer"). Backs
 * GET /api/internal/officers/pending-photos, the queue the admin app's
 * photo-review page renders.
 */
export interface PendingPhotoOfficer {
  id: string;
  firstName: string;
  lastName: string;
  departmentName: string;
  badgeNumber: string | null;
  photoUrl: string;
  createdAt: string;
}

export interface ListPendingPhotosResponse {
  officers: PendingPhotoOfficer[];
}

/**
 * proposed_record shape for a candidate new officer awaiting review.
 * Matches the seed data's example JSON.
 */
export interface OfficerCandidateProposal {
  type: "officer_candidate";
  firstName: string;
  lastName: string;
  departmentName: string;
  badgeNumber?: string;
  postCertificationId?: string;
  note?: string;
}

/** proposed_record shape for a candidate new incident awaiting review. */
export interface IncidentCandidateProposal {
  type: "incident_candidate";
  officerId?: string; // set when matched to an existing officer
  officerName?: string; // set when not yet matched
  departmentName: string;
  incidentType: IncidentType;
  shortDescription: string;
  date?: string;
  note?: string;
}

export type ReviewQueueProposal = OfficerCandidateProposal | IncidentCandidateProposal;

export interface ReviewQueueItem {
  id: string;
  proposedRecord: ReviewQueueProposal;
  source: Source | null;
  matchConfidence: MatchConfidence;
  status: ReviewQueueStatus;
  reviewerId: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface Dispute {
  id: string;
  incidentId: string | null;
  outcomeId: string | null;
  officerId: string | null;
  requesterName: string;
  requesterRole: DisputeRequesterRole;
  claim: string;
  evidenceUrl: string | null;
  submittedAt: string;
  status: DisputeStatus;
  resolutionNotes: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface Reviewer {
  id: string;
  name: string;
  email: string;
  role: "admin" | "reviewer";
  active: boolean;
}

// ---------------------------------------------------------------------------
// Public API contract (base path /api/public) — no auth
// ---------------------------------------------------------------------------

export interface SearchOfficersResponse {
  candidates: OfficerSearchCandidate[];
}

export interface GetOfficerResponse {
  officer: OfficerDetail;
}

export interface GetDepartmentStatsResponse {
  department: Department;
  stats: DepartmentStats;
}

export interface ListDepartmentsResponse {
  departments: Department[];
}

// ---------------------------------------------------------------------------
// Internal API contract (base path /api/internal) — bearer token auth
// ---------------------------------------------------------------------------

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  reviewer: Reviewer;
}

export interface ListReviewQueueResponse {
  items: ReviewQueueItem[];
}

export interface ApproveReviewQueueItemRequest {
  /** Optional field-level edits applied before promotion to the public schema. */
  edits?: Partial<Record<string, unknown>>;
}

export interface RejectReviewQueueItemRequest {
  reason: string;
}

export interface ListDisputesResponse {
  disputes: Dispute[];
}

export interface ResolveDisputeRequest {
  status: Exclude<DisputeStatus, "open">;
  resolutionNotes: string;
}

// ---------------------------------------------------------------------------
// Public API additions (post-MVP build-out)
// ---------------------------------------------------------------------------

export interface PageInfo {
  page: number;
  pageSize: number;
  totalCount: number;
}

/** GET /api/public/officers — browse/filter, distinct from the disambiguation search endpoint. */
export interface ListOfficersResponse {
  officers: OfficerSearchCandidate[];
  pageInfo: PageInfo;
}

export interface CreatePublicDisputeRequest {
  incidentId?: string;
  outcomeId?: string;
  officerId?: string;
  requesterName: string;
  requesterRole: DisputeRequesterRole;
  claim: string;
  evidenceUrl?: string;
}

export interface CreatePublicDisputeResponse {
  dispute: Dispute;
}

/**
 * GET /api/public/disputes/:id — deliberately narrow (id/status/submittedAt
 * only), NOT the full Dispute shape: this endpoint is reachable by anyone
 * who has the id (returned at submission time), so it must never leak
 * another submitter's requesterName/claim/evidenceUrl. Full detail stays
 * internal-only via the reviewer-authenticated API.
 */
export interface DisputeStatusResponse {
  id: string;
  status: DisputeStatus;
  submittedAt: string;
  resolvedAt: string | null;
}

// ---------------------------------------------------------------------------
// Internal API additions (post-MVP build-out)
// ---------------------------------------------------------------------------

/** GET /api/internal/officers/search — same matching behavior as the public
 * search endpoint, mirrored under internal auth so the admin app's officer
 * picker (for resolving an unmatched incident_candidate) doesn't have to
 * depend on the public service being reachable. */
export type SearchInternalOfficersResponse = SearchOfficersResponse;

export interface CreateDepartmentRequest {
  name: string;
  state: string;
  jurisdictionType: string;
  contactInfo?: string;
  recordsRequestPortalUrl?: string;
}

export interface CreateOfficerRequest {
  firstName: string;
  lastName: string;
  knownAliases?: string[];
  departmentId: string;
  badgeNumber?: string;
  rank?: string;
  hireDate?: string;
  employmentStatus?: EmploymentStatus; // defaults to 'active'
  postCertificationId?: string;
  photoUrl?: string;
}

export interface CreateSourceRequest {
  sourceType: SourceType;
  url: string;
  publicationDate?: string;
  retrievedDate?: string; // defaults to today
  reliabilityTier: ReliabilityTier;
}

export interface CreateIncidentRequest {
  departmentId: string;
  date: string;
  incidentType: IncidentType;
  shortDescription: string;
  status?: IncidentStatus; // defaults to 'alleged'
  officerIds: string[]; // at least one; involvementRole defaults to 'primary' for the first, 'other' for rest
  /** Existing source ids to cite immediately (a source must already exist — create it first via CreateSourceRequest if needed). */
  sourceIds?: string[];
}

export interface CreateOutcomeRequest {
  incidentId: string;
  outcomeType: OutcomeType;
  date?: string;
  amountCents?: number;
  currency?: string; // defaults to 'USD'
  details?: string;
  sourceIds?: string[];
}

export interface CreateCitationRequest {
  sourceId: string;
  citableType: CitableType;
  citableId: string;
}

/** Manual-entry responses all follow this shape: the created row, plus
 * confirmation a record_revisions entry was written (DESIGN.md §3's
 * evidentiary audit trail applies to manual entry exactly as it does to
 * review-queue approvals — there is no "off the record" write path).
 * `revisionId` is omitted for record types record_revisions can't reference:
 * its `record_type` CHECK constraint only allows officer/incident/outcome/
 * source (DESIGN.md §4, migration 0011) — departments and citations aren't
 * revision-tracked, the same precedent already applied to citations. Callers
 * creating a department should expect `revisionId` to be absent, not treat
 * it as a bug. */
export interface CreateRecordResponse<T> {
  record: T;
  revisionId?: string;
}

export interface CreateReviewerRequest {
  name: string;
  email: string;
  role: "admin" | "reviewer";
  password: string;
}

export interface UpdateReviewerRequest {
  role?: "admin" | "reviewer";
  active?: boolean;
}

export interface ListReviewersResponse {
  reviewers: Reviewer[];
}

export interface RecordRevision {
  id: string;
  recordType: "officer" | "incident" | "outcome" | "source";
  recordId: string;
  changeType: "create" | "update" | "approve" | "reject" | "dispute_resolution";
  diff: Record<string, unknown> | null;
  changedByReviewerId: string | null;
  changedByReviewerName: string | null;
  createdAt: string;
}

export interface ListRecordRevisionsResponse {
  revisions: RecordRevision[];
  pageInfo: PageInfo;
}

/**
 * GET /api/internal/review-queue/digest — DESIGN.md §7's "12 new candidate
 * records this week, 9 auto-matched with high confidence, 3 need your
 * input" weekly-digest feature. periodDays defaults to 7 if not specified
 * by the caller.
 */
export interface ReviewDigest {
  periodStart: string;
  periodEnd: string;
  newCount: number;
  highConfidenceCount: number;
  needsAttentionCount: number; // medium/low confidence, still pending
  approvedCount: number;
  rejectedCount: number;
  openDisputeCount: number;
}

export interface GetReviewDigestResponse {
  digest: ReviewDigest;
}

/**
 * POST /api/internal/review-queue/bulk-approve — DESIGN.md §7's "bulk-approve
 * a whole batch from a single trusted source after spot-checking a sample."
 * Server-side enforces the same tier1/tier2-only rule as single-item
 * one-click approve; a request containing any tier3/tier4-sourced or
 * non-high-confidence item fails that item individually rather than the
 * whole batch (see `failed` below) — never silently downgrades the rule.
 */
export interface BulkApproveRequest {
  reviewQueueIds: string[];
}

export interface BulkApproveResponse {
  approved: string[];
  failed: { id: string; error: string }[];
}

// ---------------------------------------------------------------------------
// Shared error shape
// ---------------------------------------------------------------------------

export interface ApiErrorResponse {
  error: string;
  message: string;
}

/**
 * Standard disclaimer copy referenced by OfficerDetail.disclaimer above —
 * exported so the internal API (or a future CMS) can be the single place
 * this text is edited, per DESIGN.md §3's requirement that it be reviewed
 * with counsel rather than freely edited per-page.
 */
export const STANDARD_OFFICER_PAGE_DISCLAIMER =
  "Records on this page are drawn from public documents cited alongside each entry. " +
  '"Alleged" means a claim has been made but not yet resolved; "sustained" means an ' +
  "investigating body found the claim supported after review; \"unsustained\" and " +
  '"exonerated" mean an investigating body did not sustain the claim. Inclusion of a ' +
  "record on this page is not itself a finding of wrongdoing. See our correction " +
  "process if you believe a record here is inaccurate.";
