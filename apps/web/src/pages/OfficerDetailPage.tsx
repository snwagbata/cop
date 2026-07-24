import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { OfficerDetail } from "@cop/shared-types";
import { ApiError, getOfficer } from "../lib/apiClient";
import { DisclaimerBlock } from "../components/DisclaimerBlock";
import { PhotoOrPlaceholder } from "../components/PhotoOrPlaceholder";
import { IncidentCard } from "../components/IncidentCard";
import { ResolvedDisputeNote } from "../components/ResolvedDisputeNote";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { findResolvedDisputes } from "../lib/resolvedDisputes";
import { formatDateRange, label } from "../lib/format";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; officer: OfficerDetail };

/**
 * Officer detail page (DESIGN.md §2, §3, §6).
 *
 *  - The disclaimer block is rendered verbatim near the top, not the footer.
 *  - Every departmentHistory entry is shown (the "wandering officer"
 *    timeline) so a multi-department history is visible at a glance.
 *  - Incidents render in the order the API returns them — this component
 *    applies NO client-side filter or re-sort, so a sustained finding is
 *    never surfaced without the dismissals/exonerations for the same
 *    officer that the API also included (§3's anti-juxtaposition rule).
 */
export function OfficerDetailPage() {
  const { id = "" } = useParams();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    getOfficer(id)
      .then((res) => {
        if (!cancelled) setState({ status: "ready", officer: res.officer });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError && err.status === 404
            ? "No officer record found for this ID."
            : err instanceof ApiError
              ? err.message
              : "Something went wrong loading this officer. Please try again.";
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.status === "loading") {
    return <p className="loading-state">Loading officer record…</p>;
  }

  if (state.status === "error") {
    return (
      <div className="error-state" role="alert">
        {state.message}
      </div>
    );
  }

  const { officer } = state;
  const initials = `${officer.firstName[0] ?? ""}${officer.lastName[0] ?? ""}`.toUpperCase();
  const officerLevelDisputes = findResolvedDisputes(officer.resolvedDisputes, "officer", officer.id);

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Home", to: "/" },
          { label: "Departments", to: "/departments" },
          { label: officer.department.name, to: `/departments/${encodeURIComponent(officer.department.id)}` },
          { label: `${officer.firstName} ${officer.lastName}` },
        ]}
      />
      <div className="officer-header">
        <PhotoOrPlaceholder
          photoUrl={officer.photoUrl}
          alt={`${officer.firstName} ${officer.lastName}`}
          initials={initials}
          className="officer-header__photo"
        />
        <div>
          <h1 className="page-title">
            {officer.firstName} {officer.lastName}
          </h1>
          {officer.knownAliases.length > 0 && (
            <p className="subtitle">Also known as: {officer.knownAliases.join(", ")}</p>
          )}
          <ul className="officer-header__facts">
            <li>{officer.department.name}</li>
            <li>Badge {officer.badgeNumber ?? "unknown"}</li>
            {officer.rank && <li>{officer.rank}</li>}
            <li>
              <span className="employment-status">{label(officer.employmentStatus)}</span>
            </li>
          </ul>
        </div>
      </div>

      <DisclaimerBlock text={officer.disclaimer} />

      <ResolvedDisputeNote disputes={officerLevelDisputes} />

      <p>
        <Link className="btn btn-secondary" to={`/disputes/new?officerId=${encodeURIComponent(officer.id)}`}>
          Dispute this officer's record
        </Link>
      </p>

      <section className="page-section">
        <h2>Department history</h2>
        {officer.departmentHistory.length === 0 ? (
          <p className="subtitle">No department history on file.</p>
        ) : (
          <ul className="history-list">
            {officer.departmentHistory.map((entry, i) => (
              <li className="history-item" key={`${entry.departmentId}-${entry.startDate}-${i}`}>
                <div className="history-item__dept">{entry.departmentName}</div>
                <div className="history-item__meta">
                  Badge {entry.badgeNumber ?? "unknown"} · {formatDateRange(entry.startDate, entry.endDate)}
                  {entry.separationReason ? ` · ${entry.separationReason}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="page-section">
        <h2>Incidents</h2>
        {officer.incidents.length === 0 ? (
          <p className="subtitle">No incidents on file for this officer.</p>
        ) : (
          officer.incidents.map((incident) => (
            <IncidentCard key={incident.id} incident={incident} resolvedDisputes={officer.resolvedDisputes} />
          ))
        )}
      </section>
    </div>
  );
}
