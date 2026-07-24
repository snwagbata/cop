import type pg from "pg";
import type { IncidentType, MatchConfidence, ReliabilityTier, SourceType } from "@cop/shared-types";

/**
 * Minimal shape both a `pg` Pool and a checked-out PoolClient satisfy --
 * identical in spirit to apps/api-internal/src/db.ts's Queryable, mirrored
 * here rather than imported so this package has no dependency on either API
 * service. Every function in this package takes a Queryable (not a
 * concrete Pool/Client type) so callers can pass either a pool for a single
 * statement or a transactional client for a multi-statement write (see
 * queue.ts, which requires a checked-out client since it writes two rows
 * that must commit/rollback together).
 */
export type Queryable = {
  query: <T extends pg.QueryResultRow = any>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

/**
 * The common shape every pipeline normalizes its source-specific data into,
 * before it becomes a `sources` row + `review_queue` row -- the first arrow
 * in INGESTION_DESIGN.md §2's pipeline shape diagram:
 *
 *   fetch (source-specific) -> normalize (source-specific -> CandidateItem)
 *     -> dedupe -> pre-filter -> [LLM] -> entity match -> queue
 *
 * Deliberately mirrors apps/api-public/src/routes/tips.ts's tip-intake shape
 * (source-agnostic input -> a `sources` row + a `review_queue` row carrying
 * an IncidentCandidateProposal) -- a pipeline's CandidateItem is the same
 * idea generalized to any source_type instead of just 'tip_submission'.
 *
 * `externalRef` is this item's dedup key (migration 0019's
 * sources.external_ref) -- optional here because manual entry and tips
 * don't have a natural one, but every real automated pipeline should set it
 * so a daily/weekly run doesn't re-queue the same court filing or registry
 * row every time it runs (see dedupe.ts's hasBeenQueued).
 */
export interface CandidateItem {
  sourceType: SourceType;
  /** Link to the source document/article, if the pipeline has one. */
  externalUrl?: string;
  /** The source's own stable identifier for this item (a CourtListener
   * docket id, a registry row id, a normalized article URL, etc.) -- the
   * dedup key checked by hasBeenQueued/enforced by migration 0019's partial
   * unique index on sources(source_type, external_ref). */
  externalRef?: string;
  reliabilityTier: ReliabilityTier;
  officerNameAsReported?: string;
  departmentNameAsReported?: string;
  /** DESIGN.md §6's primary cross-department identity key, if the source
   * provides one directly (e.g. a decertification registry row) -- fed into
   * matchOfficer as the primary signal. */
  postCertificationIdAsReported?: string;
  incidentType?: IncidentType;
  shortDescription: string;
  /** Free text as reported by the source, not validated as a real date --
   * same convention as CreatePublicTipRequest.incidentDateAsReported. */
  dateAsReported?: string;
  note?: string;
}

/** Result of matchOfficer (match.ts) -- DESIGN.md §6's match_confidence,
 * decided once by the shared matching helper so no individual pipeline can
 * get the conflict rule wrong. */
export interface MatchResult {
  officerId: string | null;
  confidence: MatchConfidence;
}
