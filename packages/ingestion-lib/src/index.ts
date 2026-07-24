/**
 * Shared plumbing every ingestion pipeline depends on (INGESTION_DESIGN.md
 * §2). This is foundational infrastructure only -- no pipeline (CourtListener,
 * Juriscraper, news monitoring, etc.) is implemented in this package.
 */
export type { CandidateItem, MatchResult, Queryable } from "./types.js";
export { hasBeenQueued } from "./dedupe.js";
export { matchOfficer } from "./match.js";
export { queueCandidate } from "./queue.js";
export { startRun, finishRun } from "./runLogger.js";
