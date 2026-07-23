import type { Outcome, ResolvedDisputeSummary } from "@cop/shared-types";
import { Badge } from "./Badge";
import { CitationList } from "./CitationList";
import { ResolvedDisputeNote } from "./ResolvedDisputeNote";
import { outcomeTypeCategory } from "../lib/badges";
import { findResolvedDisputes } from "../lib/resolvedDisputes";
import { formatCentsAsCurrency, formatDate, label } from "../lib/format";

export function OutcomeCard({
  outcome,
  resolvedDisputes = [],
}: {
  outcome: Outcome;
  /** Full resolvedDisputes list from the officer record; filtered here per-target (§12 right-of-reply). */
  resolvedDisputes?: ResolvedDisputeSummary[];
}) {
  const outcomeDisputes = findResolvedDisputes(resolvedDisputes, "outcome", outcome.id);
  return (
    <li className="outcome-card">
      <div className="outcome-card__top">
        <Badge category={outcomeTypeCategory(outcome.outcomeType)}>{label(outcome.outcomeType)}</Badge>
        {outcome.date && <span>{formatDate(outcome.date)}</span>}
        {outcome.amountCents != null && (
          <span className="outcome-card__amount">
            {formatCentsAsCurrency(outcome.amountCents, outcome.currency)}
          </span>
        )}
      </div>
      {outcome.details && <p className="outcome-card__details">{outcome.details}</p>}
      <p className="citation-heading">Sources for this outcome</p>
      <CitationList citations={outcome.citations} />
      <ResolvedDisputeNote disputes={outcomeDisputes} />
    </li>
  );
}
