import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Department, DepartmentStats } from "@cop/shared-types";
import { ApiError, getDepartmentStats } from "../lib/apiClient";
import { formatCentsAsCurrency, formatDate } from "../lib/format";
import { Breadcrumbs } from "../components/Breadcrumbs";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; department: Department; stats: DepartmentStats };

/**
 * Department scorecard page (DESIGN.md §2, §3, §4).
 *
 * These figures are presented as raw numbers/facts — explicitly not a
 * ranking, grade, or "score". Per §3, no traffic-light coloring or star
 * rating is used anywhere on this page; every number below is styled
 * identically regardless of magnitude, and there is no cross-department
 * comparison or ranking UI. This is a real distinction, not a cosmetic one:
 * the numbers are computed exclusively from already-published, individually
 * sourced incidents/outcomes (§4's department_stats).
 */
export function DepartmentStatsPage() {
  const { id = "" } = useParams();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    getDepartmentStats(id)
      .then((res) => {
        if (!cancelled) setState({ status: "ready", department: res.department, stats: res.stats });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError && err.status === 404
            ? "No department found for this ID."
            : err instanceof ApiError
              ? err.message
              : "Something went wrong loading department stats.";
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.status === "loading") return <p className="loading-state">Loading department record…</p>;
  if (state.status === "error") {
    return (
      <div className="error-state" role="alert">
        {state.message}
      </div>
    );
  }

  const { department, stats } = state;

  return (
    <div>
      <Breadcrumbs
        items={[{ label: "Home", to: "/" }, { label: "Departments", to: "/departments" }, { label: department.name }]}
      />
      <h1 className="page-title">{department.name}</h1>
      <p className="subtitle">
        {department.state} · {department.jurisdictionType}
      </p>
      {department.recordsRequestPortalUrl && (
        <p>
          <a href={department.recordsRequestPortalUrl} target="_blank" rel="noopener noreferrer">
            Public records request portal
          </a>
        </p>
      )}
      {department.contactInfo && <p className="subtitle">{department.contactInfo}</p>}

      <section className="page-section">
        <h2>Aggregate accountability record</h2>
        <p className="subtitle">
          These are raw counts and dollar totals aggregated from published, individually sourced records — not a
          rating, grade, or ranking of this department.
        </p>
        <div className="stats-grid">
          <div className="stat-tile">
            <span className="stat-tile__value">{formatCentsAsCurrency(stats.totalSettlementAmountCents)}</span>
            <span className="stat-tile__label">Total settlement amount</span>
          </div>
          <div className="stat-tile">
            <span className="stat-tile__value">{stats.sustainedComplaintCount.toLocaleString()}</span>
            <span className="stat-tile__label">Sustained complaints</span>
          </div>
          <div className="stat-tile">
            <span className="stat-tile__value">{stats.totalIncidentCount.toLocaleString()}</span>
            <span className="stat-tile__label">Total incidents on file</span>
          </div>
          <div className="stat-tile">
            <span className="stat-tile__value">{stats.wanderingOfficerHireCount.toLocaleString()}</span>
            <span className="stat-tile__label">Wandering-officer hires</span>
          </div>
        </div>
        <p className="stats-note">Figures last computed {formatDate(stats.lastComputedAt)}.</p>
      </section>

      <p>
        <Link className="btn btn-secondary" to={`/departments/${encodeURIComponent(department.id)}/officers`}>
          Browse officers in this department
        </Link>
      </p>
    </div>
  );
}
