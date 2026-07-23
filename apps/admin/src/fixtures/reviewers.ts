import type { Reviewer } from "@cop/shared-types";

export const reviewerFixtures: Reviewer[] = [
  { id: "rev-1", name: "Admin Reviewer", email: "reviewer@example.org", role: "admin", active: true },
  { id: "rev-2", name: "Sam Reviewer", email: "sam@example.org", role: "reviewer", active: true },
  { id: "rev-3", name: "Former Reviewer", email: "former@example.org", role: "reviewer", active: false },
];
