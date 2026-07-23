import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { ListOfficersResponse } from "@cop/shared-types";
import { ApiError, listOfficers } from "../lib/apiClient";
import { PhotoOrPlaceholder } from "../components/PhotoOrPlaceholder";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ListOfficersResponse };

const PAGE_SIZE = 20;

/**
 * Officer browse page (task item 5, optional/lower-priority). Uses
 * GET /api/public/officers?departmentId=&page= — distinct from the
 * disambiguation-only search endpoint, so this is a plain paginated roster
 * scoped to one department, not a free-text lookup. DESIGN.md §9 only
 * exempts department-scoped listing (never a full unscoped roster) from the
 * "no bulk officer list" rule, so this page always requires a departmentId.
 */
export function OfficersBrowsePage() {
  const { id: departmentId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") ?? "1") || 1;
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    listOfficers({ departmentId, page, pageSize: PAGE_SIZE })
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError
            ? err.message
            : "Something went wrong loading officers for this department.";
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [departmentId, page]);

  return (
    <div>
      <h1 className="page-title">Browse officers</h1>
      <p className="subtitle">
        <Link to={`/departments/${encodeURIComponent(departmentId)}`}>Back to department record</Link>
      </p>

      {state.status === "loading" && <p className="loading-state">Loading officers…</p>}
      {state.status === "error" && (
        <div className="error-state" role="alert">
          {state.message}
        </div>
      )}
      {state.status === "ready" && state.data.officers.length === 0 && (
        <div className="empty-state">No officers on file for this department yet.</div>
      )}
      {state.status === "ready" && state.data.officers.length > 0 && (
        <>
          <ul className="officer-list">
            {state.data.officers.map((o) => {
              const initials = `${o.firstName[0] ?? ""}${o.lastName[0] ?? ""}`.toUpperCase();
              return (
                <li key={o.id}>
                  <Link to={`/officers/${encodeURIComponent(o.id)}`}>
                    <PhotoOrPlaceholder
                      photoUrl={o.photoUrl}
                      alt={`${o.firstName} ${o.lastName}`}
                      initials={initials}
                      className="candidate-card__photo"
                    />
                    <span>
                      <strong>
                        {o.firstName} {o.lastName}
                      </strong>
                      <div className="candidate-card__detail">Badge {o.badgeNumber ?? "unknown"}</div>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <nav className="pagination" aria-label="Officer list pages">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={page <= 1}
              onClick={() => setParams({ page: String(page - 1) })}
            >
              Previous
            </button>
            <span className="pagination__status">
              Page {state.data.pageInfo.page} of{" "}
              {Math.max(1, Math.ceil(state.data.pageInfo.totalCount / state.data.pageInfo.pageSize))} (
              {state.data.pageInfo.totalCount} total)
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={page * state.data.pageInfo.pageSize >= state.data.pageInfo.totalCount}
              onClick={() => setParams({ page: String(page + 1) })}
            >
              Next
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
