import type { RecordRevision } from "@cop/shared-types";

export const revisionFixtures: RecordRevision[] = [
  {
    id: "rev-101",
    recordType: "officer",
    recordId: "off-204",
    changeType: "create",
    diff: { firstName: "Jordan", lastName: "Michaels", departmentId: "dept-1" },
    changedByReviewerId: "rev-1",
    changedByReviewerName: "Admin Reviewer",
    createdAt: "2026-07-15T09:05:00.000Z",
  },
  {
    id: "rev-102",
    recordType: "incident",
    recordId: "inc-101",
    changeType: "approve",
    diff: { status: "sustained" },
    changedByReviewerId: "rev-1",
    changedByReviewerName: "Admin Reviewer",
    createdAt: "2026-07-16T14:35:00.000Z",
  },
];
