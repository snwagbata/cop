// Fixed UUIDs from db/seed/0001_synthetic_sample_data.sql, mirrored here the
// same way packages/db-tests/src/support/seed-ids.ts does, so this
// package's tests can assert against the known seed baseline by name.
export const SEED = {
  reviewers: {
    admin: "00000000-0000-0000-0000-000000000021",
  },
  departments: {
    springfield: "00000000-0000-0000-0000-000000000001",
    shelbyville: "00000000-0000-0000-0000-000000000002",
  },
  officers: {
    // Single-department officer, active at Springfield.
    janeDoe: {
      id: "00000000-0000-0000-0000-000000000011",
      name: "Jane Doe",
      postCertificationId: "CA-POST-000111",
      departmentName: "Springfield Police Department (fictional)",
    },
    // The "wandering officer" case: terminated from Shelbyville, later hired
    // at Springfield under a different badge number.
    robertSmith: {
      id: "00000000-0000-0000-0000-000000000012",
      name: "Robert Smith",
      postCertificationId: "CA-POST-000222",
      departmentName: "Springfield Police Department (fictional)",
    },
    // Single-department officer, active at Shelbyville.
    mariaNguyen: {
      id: "00000000-0000-0000-0000-000000000013",
      name: "Maria Nguyen",
      postCertificationId: "CA-POST-000333",
      departmentName: "Shelbyville Police Department (fictional)",
    },
  },
} as const;
