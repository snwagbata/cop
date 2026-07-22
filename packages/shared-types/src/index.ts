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
