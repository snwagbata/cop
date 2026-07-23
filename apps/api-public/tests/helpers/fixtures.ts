/**
 * Fixed UUIDs and known-good expected values from
 * db/seed/0001_synthetic_sample_data.sql. Read-only tests can assert
 * directly against these per db/TESTING.md — do not hand-roll fixtures.
 */

// -- Departments --------------------------------------------------------
export const SPRINGFIELD_DEPT_ID = "00000000-0000-0000-0000-000000000001";
export const SHELBYVILLE_DEPT_ID = "00000000-0000-0000-0000-000000000002";

// -- Sources --------------------------------------------------------------
export const SOURCE_DECERTIFICATION_REGISTRY = "00000000-0000-0000-0000-000000000031";
export const SOURCE_COURT_DOC_SETTLEMENT = "00000000-0000-0000-0000-000000000032";
export const SOURCE_NEWS_ARTICLE = "00000000-0000-0000-0000-000000000033";

// -- Officers ---------------------------------------------------------------
// Officer A: single-department, currently active at Springfield.
export const JANE_DOE_ID = "00000000-0000-0000-0000-000000000011";
// Officer B: the "wandering officer" — terminated from Shelbyville (badge 55),
// later hired at Springfield (badge 303).
export const ROBERT_SMITH_ID = "00000000-0000-0000-0000-000000000012";
// Officer C: single-department, currently active at Shelbyville.
export const MARIA_NGUYEN_ID = "00000000-0000-0000-0000-000000000013";

// -- Incidents ----------------------------------------------------------
// Jane Doe's sustained use-of-force incident at Springfield.
export const INCIDENT_UOF_SPRINGFIELD_ID = "00000000-0000-0000-0000-000000000041";
// Robert Smith's sustained false-report incident at Shelbyville.
export const INCIDENT_FALSE_REPORT_SHELBYVILLE_ID = "00000000-0000-0000-0000-000000000042";

// -- Outcomes -------------------------------------------------------------
export const OUTCOME_INTERNAL_DISCIPLINE_ID = "00000000-0000-0000-0000-000000000051"; // incident 041
export const OUTCOME_TERMINATION_ID = "00000000-0000-0000-0000-000000000052"; // incident 042
// Settlement of a related federal civil rights suit, cited independently of
// incident 041's own news-article citation (court doc source, not the news
// source) — see the regression test in officers.detail.test.ts.
export const OUTCOME_LAWSUIT_SETTLEMENT_ID = "00000000-0000-0000-0000-000000000053"; // incident 041
export const OUTCOME_LAWSUIT_SETTLEMENT_AMOUNT_CENTS = 15_000_000;

// -- Reviewers ------------------------------------------------------------
export const ADMIN_REVIEWER_ID = "00000000-0000-0000-0000-000000000021";

// -- A valid-shaped but nonexistent UUID, and a malformed one, for 404/400 tests.
export const NONEXISTENT_UUID = "00000000-0000-0000-0000-000000000999";
export const MALFORMED_ID = "not-a-valid-uuid";

// -- Known department_stats totals (see db/migrations/0013_department_stats.sql
// and the seed data: outcome 053 is the only lawsuit_settlement, on incident
// 041, which belongs to Springfield). Verified directly against cop_test's
// department_stats materialized view during test-suite authoring.
export const SPRINGFIELD_STATS = {
  totalSettlementAmountCents: 15_000_000,
  sustainedComplaintCount: 1,
  totalIncidentCount: 1,
  wanderingOfficerHireCount: 1, // Robert Smith has history rows in both departments
};

export const SHELBYVILLE_STATS = {
  totalSettlementAmountCents: 0,
  sustainedComplaintCount: 1,
  totalIncidentCount: 1,
  wanderingOfficerHireCount: 1, // same officer (Robert Smith) also has a Shelbyville history row
};
