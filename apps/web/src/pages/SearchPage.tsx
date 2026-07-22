import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { OfficerSearchCandidate } from "@cop/shared-types";
import { ApiError, searchOfficers } from "../lib/apiClient";
import { CandidateCard } from "../components/CandidateCard";

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "no-results" }
  | { status: "disambiguate"; candidates: OfficerSearchCandidate[] };

/**
 * Search / home page (DESIGN.md §2).
 *
 * Search flow rules, enforced here:
 *  - 0 results -> explicit "no results" state.
 *  - exactly 1 candidate -> go straight to that officer's detail page.
 *  - >1 candidate -> mandatory disambiguation picker; incident/outcome data
 *    is never shown until a specific officer is chosen from that picker.
 *    This is the direct mitigation for misidentification, the project's
 *    #1 stated risk (§2, §3, §6) — never skipped as a UX shortcut.
 */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const initialQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const navigate = useNavigate();

  useEffect(() => {
    const q = params.get("q");
    if (!q) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    searchOfficers(q)
      .then((res) => {
        if (cancelled) return;
        if (res.candidates.length === 0) {
          setState({ status: "no-results" });
        } else if (res.candidates.length === 1) {
          navigate(`/officers/${encodeURIComponent(res.candidates[0].id)}`, { replace: true });
        } else {
          setState({ status: "disambiguate", candidates: res.candidates });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof ApiError ? err.message : "Something went wrong searching. Please try again.";
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setParams({ q: trimmed });
  }

  return (
    <div>
      <h1 className="page-title">Search for an officer</h1>
      <p className="subtitle">Search by name or badge number. Records shown here are drawn from public documents.</p>

      <form className="search-form" onSubmit={handleSubmit} role="search">
        <input
          type="search"
          name="q"
          placeholder="Name or badge number"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Officer name or badge number"
        />
        <button type="submit" disabled={state.status === "loading"}>
          Search
        </button>
      </form>

      {state.status === "loading" && <p className="loading-state">Searching…</p>}

      {state.status === "error" && (
        <div className="error-state" role="alert">
          {state.message}
        </div>
      )}

      {state.status === "no-results" && (
        <div className="empty-state">
          No officers matched "{initialQuery}". Try a different spelling, badge number, or department name.
        </div>
      )}

      {state.status === "disambiguate" && (
        <div>
          <h2>Multiple matches — select the correct officer</h2>
          <p className="subtitle">
            More than one officer matched this search. To avoid misidentification, choose the specific officer
            below before viewing any records. Compare department, badge number, and active dates.
          </p>
          <ul className="candidate-list">
            {state.candidates.map((c) => (
              <CandidateCard key={c.id} candidate={c} onSelect={(id) => navigate(`/officers/${id}`)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
