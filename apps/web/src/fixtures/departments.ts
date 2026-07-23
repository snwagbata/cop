import type { Department, DepartmentStats, ListOfficersResponse } from "@cop/shared-types";
import { officerSearchFixtures } from "./officers";

export const departmentFixtures: Department[] = [
  {
    id: "dept-1",
    name: "Riverdale Police Department",
    state: "NY",
    jurisdictionType: "municipal",
    contactInfo: "records@riverdalepd.example.gov",
    recordsRequestPortalUrl: "https://riverdalepd.example.gov/records",
  },
  {
    id: "dept-2",
    name: "Fairview County Sheriff's Office",
    state: "NY",
    jurisdictionType: "county",
    contactInfo: null,
    recordsRequestPortalUrl: null,
  },
];

export const departmentStatsFixture: DepartmentStats = {
  departmentId: "dept-1",
  totalSettlementAmountCents: 12_500_000,
  sustainedComplaintCount: 7,
  totalIncidentCount: 23,
  wanderingOfficerHireCount: 2,
  lastComputedAt: "2023-06-01T00:00:00.000Z",
};

export const listOfficersPageOneFixture: ListOfficersResponse = {
  officers: officerSearchFixtures,
  pageInfo: { page: 1, pageSize: 20, totalCount: 42 },
};

export const listOfficersLastPageFixture: ListOfficersResponse = {
  officers: [officerSearchFixtures[0]],
  pageInfo: { page: 3, pageSize: 20, totalCount: 42 },
};

export const listOfficersEmptyFixture: ListOfficersResponse = {
  officers: [],
  pageInfo: { page: 1, pageSize: 20, totalCount: 0 },
};
