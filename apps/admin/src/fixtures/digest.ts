import type { ReviewDigest } from "@cop/shared-types";

export const digestFixture: ReviewDigest = {
  periodStart: "2026-07-13T00:00:00.000Z",
  periodEnd: "2026-07-20T00:00:00.000Z",
  newCount: 12,
  highConfidenceCount: 9,
  needsAttentionCount: 3,
  approvedCount: 8,
  rejectedCount: 1,
  openDisputeCount: 2,
};
