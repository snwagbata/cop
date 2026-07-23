import type { ResolvedDisputeSummary } from "@cop/shared-types";
import { Badge } from "./Badge";
import { formatDate, label } from "../lib/format";

/**
 * Right-of-reply inline display (DESIGN.md §12 backlog item — "shown inline
 * on the record page (not just logged in disputes.resolution_notes)").
 * Renders one card per resolved dispute that targets the specific
 * incident/outcome/officer section it's attached to, using the distinct
 * badge-review / --status-review-* visual treatment so it reads as a
 * correction-process outcome, not as another incident/outcome badge.
 */
export function ResolvedDisputeNote({ disputes }: { disputes: ResolvedDisputeSummary[] }) {
  if (disputes.length === 0) return null;
  return (
    <div className="stack-sm">
      {disputes.map((d, i) => (
        <div className="resolved-dispute" key={`${d.targetType}-${d.targetId}-${i}`}>
          <div className="resolved-dispute__heading">
            <Badge category="review">{label(d.status)}</Badge>
            <span className="resolved-dispute__date">resolved {formatDate(d.resolvedAt)}</span>
          </div>
          <p className="resolved-dispute__notes">{d.resolutionNotes}</p>
        </div>
      ))}
    </div>
  );
}
