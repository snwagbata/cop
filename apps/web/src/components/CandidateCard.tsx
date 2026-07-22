import type { OfficerSearchCandidate } from "@cop/shared-types";
import { PhotoOrPlaceholder } from "./PhotoOrPlaceholder";
import { formatDateRange } from "../lib/format";

/**
 * One row of the mandatory disambiguation picker (DESIGN.md §2/§6). Shows
 * department, badge number, active date range, and photo-or-placeholder —
 * exactly the signals a person needs to pick the right officer before any
 * incident data is shown.
 */
export function CandidateCard({
  candidate,
  onSelect,
}: {
  candidate: OfficerSearchCandidate;
  onSelect: (id: string) => void;
}) {
  const initials = `${candidate.firstName[0] ?? ""}${candidate.lastName[0] ?? ""}`.toUpperCase();
  return (
    <li>
      <button className="candidate-card" onClick={() => onSelect(candidate.id)}>
        <PhotoOrPlaceholder
          photoUrl={candidate.photoUrl}
          alt={`${candidate.firstName} ${candidate.lastName}`}
          initials={initials}
          className="candidate-card__photo"
        />
        <span className="candidate-card__meta">
          <span className="candidate-card__name">
            {candidate.firstName} {candidate.lastName}
          </span>
          <span className="candidate-card__detail">{candidate.departmentName}</span>
          <span className="candidate-card__detail">
            Badge {candidate.badgeNumber ?? "unknown"} · Active{" "}
            {formatDateRange(candidate.activeDateRange.start, candidate.activeDateRange.end)}
          </span>
        </span>
      </button>
    </li>
  );
}
