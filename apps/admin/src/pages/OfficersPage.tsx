import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { OfficerSearchCandidate } from "@cop/shared-types";
import * as api from "../api/client";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

/**
 * Standalone officer lookup page -- deliberately separate from
 * OfficerSearchPicker (components/OfficerSearchPicker.tsx), which is a
 * reusable picker whose results fire onSelect back into whatever form
 * embeds it (review-queue resolution, incident forms). This page's
 * results are real navigation links instead, since here "finding an
 * officer" IS the whole task, not a step inside a larger form.
 */
export function OfficersPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OfficerSearchCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (query.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    const thisRequest = ++requestId.current;
    const timer = setTimeout(async () => {
      try {
        const res = await api.searchOfficers(query.trim());
        if (requestId.current === thisRequest) {
          setResults(res.candidates);
          setError(null);
          setSearched(true);
        }
      } catch (err) {
        if (requestId.current === thisRequest) {
          setResults([]);
          setError(err instanceof Error ? err.message : "Officer search failed.");
        }
      } finally {
        if (requestId.current === thisRequest) {
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div>
      <h1 className="page-title">Officers</h1>
      <p className="page-subtitle">Search by name or badge number to view or edit an officer's record.</p>

      <div className="field">
        <label htmlFor="officers-search">Search</label>
        <input
          id="officers-search"
          type="text"
          value={query}
          placeholder="Start typing a name…"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading && <p className="loading-state">Searching…</p>}
      {!loading && error && (
        <div className="error-state" role="alert">
          {error}
        </div>
      )}
      {!loading && !error && searched && results.length === 0 && (
        <div className="empty-state">No matching officers.</div>
      )}

      {!loading && !error && results.length > 0 && (
        <ul className="officer-list">
          {results.map((c) => (
            <li key={c.id}>
              <Link to={`/officers/${encodeURIComponent(c.id)}`}>
                <span>
                  <strong>
                    {c.firstName} {c.lastName}
                  </strong>
                  <div className="candidate-card__detail">
                    {c.departmentName} · {c.badgeNumber ? `badge #${c.badgeNumber}` : "no badge on file"}
                  </div>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
