// Fixed UUIDs from db/seed/0001_synthetic_sample_data.sql, mirrored the same
// way packages/ingestion-lib/src/support/seed-ids.ts does, so this suite's
// tests can assert against the known seed baseline by name.
export const SEED = {
  departments: {
    springfield: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Springfield Police Department (fictional)",
    },
    shelbyville: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "Shelbyville Police Department (fictional)",
    },
    nyc: {
      id: "00000000-0000-0000-0000-000000000003",
      name: "New York City Police Department",
    },
  },
  officers: {
    janeDoe: {
      id: "00000000-0000-0000-0000-000000000011",
      name: "Jane Doe",
      departmentName: "Springfield Police Department (fictional)",
    },
    robertSmith: {
      id: "00000000-0000-0000-0000-000000000012",
      name: "Robert Smith",
      departmentName: "Springfield Police Department (fictional)",
    },
    mariaNguyen: {
      id: "00000000-0000-0000-0000-000000000013",
      name: "Maria Nguyen",
      departmentName: "Shelbyville Police Department (fictional)",
    },
  },
} as const;
