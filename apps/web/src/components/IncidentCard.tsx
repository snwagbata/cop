import { Link } from "react-router";
import type { Incident, ResolvedDisputeSummary } from "@cop/shared-types";
import { Badge } from "./Badge";
import { CitationList } from "./CitationList";
import { OutcomeCard } from "./OutcomeCard";
import { ResolvedDisputeNote } from "./ResolvedDisputeNote";
import { incidentStatusCategory } from "../lib/badges";
import { findResolvedDisputes } from "../lib/resolvedDisputes";
import { formatDate, label } from "../lib/format";

/**
 * DESIGN.md §3 hard rules applied here:
 *  - the incident status badge is rendered at least as prominently as the
 *    description text (bold badge vs. plain paragraph copy, never smaller);
 *  - outcome type is likewise rendered via the same Badge component inside
 *    OutcomeCard, never as secondary/lighter styling;
 *  - every incident shows its own citations, independent of outcome
 *    citations, since outcomes can carry citations the parent incident
 *    doesn't (§4).
 */
export function IncidentCard({
  incident,
  resolvedDisputes = [],
}: {
  incident: Incident;
  /** Full resolvedDisputes list from the officer record; filtered here per-target (§12 right-of-reply). */
  resolvedDisputes?: ResolvedDisputeSummary[];
}) {
  const incidentDisputes = findResolvedDisputes(resolvedDisputes, "incident", incident.id);
  return (
    <article className="incident-card">
      <div className="incident-card__top">
        <div>
          <div className="incident-card__date-type">
            {formatDate(incident.date)} · {label(incident.incidentType)}
          </div>
        </div>
        <Badge category={incidentStatusCategory(incident.status)}>{label(incident.status)}</Badge>
      </div>

      {incident.officers.length > 0 && (
        <p className="incident-card__officers">
          Officers named in this incident:{" "}
          {incident.officers
            .map((o) => `${o.firstName} ${o.lastName} (${label(o.involvementRole)})`)
            .join(", ")}
        </p>
      )}

      <p className="incident-card__description">{incident.shortDescription}</p>

      <p className="citation-heading">Sources for this incident</p>
      <CitationList citations={incident.citations} />

      <ResolvedDisputeNote disputes={incidentDisputes} />

      {incident.outcomes.length > 0 && (
        <>
          <p className="citation-heading">Outcomes</p>
          <ul className="outcome-list">
            {incident.outcomes.map((outcome) => (
              <OutcomeCard key={outcome.id} outcome={outcome} resolvedDisputes={resolvedDisputes} />
            ))}
          </ul>
        </>
      )}

      <p style={{ marginTop: "0.75rem" }}>
        {/* incidentId alone is the correct, complete target — the API requires
            exactly one of incidentId/outcomeId/officerId (DESIGN.md §10), and
            the officer is already identified via incident.officers above. An
            earlier version of this link also appended officerId when rendered
            from an officer's page, which made every submission from here fail
            the API's validation; found via the apps/web test suite. */}
        <Link className="btn btn-secondary" to={`/disputes/new?incidentId=${encodeURIComponent(incident.id)}`}>
          Dispute this record
        </Link>
      </p>
    </article>
  );
}
