// Fixed UUIDs from db/seed/0001_synthetic_sample_data.sql, mirrored here so
// tests can assert against the known seed baseline by name instead of
// scattering magic UUID literals. Keep in sync with that file if it ever
// changes (it shouldn't — db/seed is not something this suite may edit).
export const SEED = {
  reviewers: {
    admin: "00000000-0000-0000-0000-000000000021",
  },
  departments: {
    springfield: "00000000-0000-0000-0000-000000000001",
    shelbyville: "00000000-0000-0000-0000-000000000002",
  },
  sources: {
    decertificationRegistry: "00000000-0000-0000-0000-000000000031",
    settlementCourtDoc: "00000000-0000-0000-0000-000000000032",
    newsArticle: "00000000-0000-0000-0000-000000000033",
  },
  officers: {
    // Single-department officer, active at Springfield.
    janeDoe: "00000000-0000-0000-0000-000000000011",
    // The "wandering officer" case: terminated from Shelbyville, later hired
    // at Springfield under a different badge number.
    robertSmith: "00000000-0000-0000-0000-000000000012",
    // Single-department officer, active at Shelbyville.
    mariaNguyen: "00000000-0000-0000-0000-000000000013",
  },
  incidents: {
    springfieldUseOfForce: "00000000-0000-0000-0000-000000000041",
    shelbyvilleFalseReport: "00000000-0000-0000-0000-000000000042",
  },
  outcomes: {
    springfieldInternalDiscipline: "00000000-0000-0000-0000-000000000051",
    shelbyvilleTermination: "00000000-0000-0000-0000-000000000052",
    springfieldLawsuitSettlement: "00000000-0000-0000-0000-000000000053",
  },
} as const;
