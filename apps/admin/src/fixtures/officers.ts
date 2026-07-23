import type { OfficerSearchCandidate } from "@cop/shared-types";

/**
 * Fixture data for the officer-search-and-select picker
 * (OfficerSearchPicker / GET /api/internal/officers/search), matching
 * @cop/shared-types' OfficerSearchCandidate exactly. Used by component
 * tests the same way src/fixtures/reviewQueue.ts and disputes.ts are.
 */
export const officerSearchFixtures: OfficerSearchCandidate[] = [
  {
    id: "off-204",
    firstName: "R.",
    lastName: "Alvarez",
    departmentId: "dept-2",
    departmentName: "Fairview County Sheriff's Office",
    badgeNumber: "1187",
    activeDateRange: { start: "2018-03-01", end: null },
    photoUrl: null,
  },
  {
    id: "off-311",
    firstName: "Robert",
    lastName: "Alvarado",
    departmentId: "dept-1",
    departmentName: "Riverdale Police Department",
    badgeNumber: "0092",
    activeDateRange: { start: "2011-06-15", end: "2022-01-01" },
    photoUrl: null,
  },
];
