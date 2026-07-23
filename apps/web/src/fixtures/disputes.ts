import type { CreatePublicDisputeResponse, Dispute, DisputeStatusResponse } from "@cop/shared-types";

export const disputeFixture: Dispute = {
  id: "disp-1",
  incidentId: "inc-1",
  outcomeId: null,
  officerId: null,
  requesterName: "Jane Doe",
  requesterRole: "subject",
  claim: "The date of the incident is incorrect.",
  evidenceUrl: null,
  submittedAt: "2023-03-01T12:00:00.000Z",
  status: "open",
  resolutionNotes: null,
  resolvedBy: null,
  resolvedAt: null,
};

export const submitDisputeResponseFixture: CreatePublicDisputeResponse = {
  dispute: disputeFixture,
};

export const disputeStatusOpenFixture: DisputeStatusResponse = {
  id: "disp-1",
  status: "open",
  submittedAt: "2023-03-01T12:00:00.000Z",
  resolvedAt: null,
};

export const disputeStatusResolvedFixture: DisputeStatusResponse = {
  id: "disp-2",
  status: "resolved_corrected",
  submittedAt: "2023-01-05T09:30:00.000Z",
  resolvedAt: "2023-01-20T15:00:00.000Z",
};
