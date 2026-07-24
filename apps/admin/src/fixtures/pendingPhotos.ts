import type { PendingPhotoOfficer } from "@cop/shared-types";

/**
 * Fixture data for the photo-review queue (GET /api/internal/officers/
 * pending-photos), matching @cop/shared-types' PendingPhotoOfficer exactly.
 * Used by PhotoReviewPage.test.tsx the same way fixtures/reviewQueue.ts and
 * fixtures/disputes.ts back their respective page tests.
 */
export const pendingPhotosFixtures: PendingPhotoOfficer[] = [
  {
    id: "off-1",
    firstName: "Jordan",
    lastName: "Michaels",
    departmentName: "Riverdale Police Department",
    badgeNumber: "4417",
    photoUrl: "https://placehold.co/200x200?text=Officer+Photo",
    createdAt: "2026-07-15T09:00:00.000Z",
  },
  {
    id: "off-2",
    firstName: "Pat",
    lastName: "Nguyen",
    departmentName: "Fairview County Sheriff's Office",
    badgeNumber: null,
    photoUrl: "https://placehold.co/200x200?text=Officer+Photo",
    createdAt: "2026-07-18T08:05:00.000Z",
  },
];
