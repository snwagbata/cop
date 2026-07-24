import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Department } from "@cop/shared-types";
import { ApiError, listDepartments } from "../lib/apiClient";
import { Breadcrumbs } from "../components/Breadcrumbs";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; departments: Department[] };

export function DepartmentsListPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    listDepartments()
      .then((res) => {
        if (!cancelled) setState({ status: "ready", departments: res.departments });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof ApiError ? err.message : "Something went wrong loading departments.";
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Departments" }]} />
      <h1 className="page-title">Departments</h1>
      <p className="subtitle">
        Browse a department's aggregate accountability record — total settlement payouts, sustained-complaint
        counts, and wandering-officer hires — presented as raw counts and totals, not a rating or grade.
      </p>

      {state.status === "loading" && <p className="loading-state">Loading departments…</p>}
      {state.status === "error" && (
        <div className="error-state" role="alert">
          {state.message}
        </div>
      )}
      {state.status === "ready" && state.departments.length === 0 && (
        <div className="empty-state">No departments on file yet.</div>
      )}
      {state.status === "ready" && state.departments.length > 0 && (
        <ul className="department-list">
          {state.departments.map((d) => (
            <li key={d.id}>
              <Link to={`/departments/${encodeURIComponent(d.id)}`}>
                <strong>{d.name}</strong>
                <div className="candidate-card__detail">
                  {d.state} · {d.jurisdictionType}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
