import type { OfficerDetail, OfficerSearchCandidate } from "@cop/shared-types";
import { STANDARD_OFFICER_PAGE_DISCLAIMER } from "@cop/shared-types";
import { sourceFixtures } from "./sources";

/** Disambiguation-picker fixtures matching OfficerSearchCandidate exactly. */
export const officerSearchFixtures: OfficerSearchCandidate[] = [
  {
    id: "off-1",
    firstName: "James",
    lastName: "Reyes",
    departmentId: "dept-1",
    departmentName: "Riverdale Police Department",
    badgeNumber: "1187",
    activeDateRange: { start: "2015-03-01", end: null },
    photoUrl: null,
  },
  {
    id: "off-2",
    firstName: "James",
    lastName: "Reyes",
    departmentId: "dept-2",
    departmentName: "Fairview County Sheriff's Office",
    badgeNumber: "0092",
    activeDateRange: { start: "2009-06-15", end: "2021-01-01" },
    photoUrl: null,
  },
];

/** A single unambiguous candidate — used for the "exactly 1 result" flow. */
export const singleOfficerCandidateFixture: OfficerSearchCandidate = officerSearchFixtures[0];

/** Full OfficerDetail fixture matching @cop/shared-types' OfficerDetail exactly. */
export const officerDetailFixture: OfficerDetail = {
  id: "off-1",
  firstName: "James",
  lastName: "Reyes",
  knownAliases: ["Jim Reyes"],
  department: {
    id: "dept-1",
    name: "Riverdale Police Department",
    state: "NY",
    jurisdictionType: "municipal",
    contactInfo: "records@riverdalepd.example.gov",
    recordsRequestPortalUrl: "https://riverdalepd.example.gov/records",
  },
  badgeNumber: "1187",
  rank: "Sergeant",
  employmentStatus: "active",
  photoUrl: null,
  departmentHistory: [
    {
      departmentId: "dept-2",
      departmentName: "Fairview County Sheriff's Office",
      badgeNumber: "0092",
      startDate: "2009-06-15",
      endDate: "2015-02-01",
      separationReason: "resigned during investigation",
    },
    {
      departmentId: "dept-1",
      departmentName: "Riverdale Police Department",
      badgeNumber: "1187",
      startDate: "2015-03-01",
      endDate: null,
      separationReason: null,
    },
  ],
  incidents: [
    {
      id: "inc-1",
      departmentId: "dept-1",
      date: "2018-07-04",
      incidentType: "use_of_force",
      shortDescription: "Use-of-force complaint during a traffic stop.",
      status: "sustained",
      officers: [{ officerId: "off-1", firstName: "James", lastName: "Reyes", involvementRole: "primary" }],
      outcomes: [
        {
          id: "out-1",
          incidentId: "inc-1",
          outcomeType: "internal_discipline",
          date: "2018-11-01",
          amountCents: null,
          currency: "USD",
          details: "Ten-day unpaid suspension.",
          citations: [sourceFixtures[0]],
        },
      ],
      citations: [sourceFixtures[0]],
    },
    {
      id: "inc-2",
      departmentId: "dept-1",
      date: "2020-02-14",
      incidentType: "false_report",
      shortDescription: "Allegation of a falsified incident report.",
      status: "unsustained",
      officers: [{ officerId: "off-1", firstName: "James", lastName: "Reyes", involvementRole: "primary" }],
      outcomes: [
        {
          id: "out-2",
          incidentId: "inc-2",
          outcomeType: "no_action",
          date: "2020-05-01",
          amountCents: null,
          currency: "USD",
          details: null,
          citations: [],
        },
      ],
      citations: [sourceFixtures[1]],
    },
    {
      id: "inc-3",
      departmentId: "dept-1",
      date: "2021-09-30",
      incidentType: "unlawful_arrest",
      shortDescription: "Civil suit alleging unlawful arrest.",
      status: "alleged",
      officers: [{ officerId: "off-1", firstName: "James", lastName: "Reyes", involvementRole: "named_defendant" }],
      outcomes: [
        {
          id: "out-3",
          incidentId: "inc-3",
          outcomeType: "lawsuit_settlement",
          date: "2022-03-15",
          amountCents: 5_000_000,
          currency: "USD",
          details: "Settled without admission of liability.",
          citations: [sourceFixtures[0]],
        },
      ],
      citations: [sourceFixtures[0], sourceFixtures[1]],
    },
  ],
  resolvedDisputes: [
    {
      targetType: "incident",
      targetId: "inc-2",
      status: "resolved_no_change",
      resolutionNotes: "Reviewed the underlying report; the record accurately reflects the source document.",
      resolvedAt: "2023-02-01",
    },
  ],
  disclaimer: STANDARD_OFFICER_PAGE_DISCLAIMER,
};

/** Same officer, but with no department history and no resolved disputes — the "empty array" cases. */
export const officerDetailEmptyHistoryFixture: OfficerDetail = {
  ...officerDetailFixture,
  id: "off-3",
  departmentHistory: [],
  incidents: [],
  resolvedDisputes: [],
};
