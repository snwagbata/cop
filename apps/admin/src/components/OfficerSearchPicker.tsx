import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { OfficerSearchCandidate } from "@cop/shared-types";
import * as api from "../api/client";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

function formatCandidateMeta(c: OfficerSearchCandidate): string {
  const badge = c.badgeNumber ? `badge #${c.badgeNumber}` : "no badge on file";
  return `${c.departmentName} · ${badge}`;
}

function formatActiveRange(c: OfficerSearchCandidate): string {
  const start = c.activeDateRange.start ? new Date(c.activeDateRange.start).getFullYear() : "?";
  const end = c.activeDateRange.end ? new Date(c.activeDateRange.end).getFullYear() : "present";
  return `${start}–${end}`;
}

interface Props {
  id: string;
  label: string;
  /**
   * "single" shows a persistent selected chip with a Change action (e.g.
   * resolving one unmatched incident to one officer). "multi" clears back
   * to an empty search box after each pick so the caller can add several
   * officers to a list it renders itself (e.g. the incident form).
   */
  mode?: "single" | "multi";
  onSelect: (candidate: OfficerSearchCandidate) => void;
  onClear?: () => void;
  disabled?: boolean;
  helpText?: string;
}

export function OfficerSearchPicker({
  id,
  label,
  mode = "single",
  onSelect,
  onClear,
  disabled = false,
  helpText,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OfficerSearchCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<OfficerSearchCandidate | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (query.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      setError(null);
      setLoading(false);
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

  function handlePick(candidate: OfficerSearchCandidate) {
    onSelect(candidate);
    setQuery("");
    setResults([]);
    setOpen(false);
    if (mode === "single") {
      setSelected(candidate);
    }
  }

  function handleChange() {
    setSelected(null);
    onClear?.();
  }

  const listboxId = `${id}-listbox`;
  const showDropdown = open && query.trim().length >= MIN_QUERY_LENGTH;

  if (mode === "single" && selected) {
    return (
      <div className="field">
        <span id={`${id}-label`} className="field-label-static">
          {label}
        </span>
        <div className="officer-chip" data-testid={`${id}-selected`}>
          <div>
            <div className="officer-chip-name">
              {selected.firstName} {selected.lastName}
            </div>
            <div className="officer-chip-meta">
              {selected.departmentName} · {selected.badgeNumber ? `badge #${selected.badgeNumber}` : "no badge on file"} ·{" "}
              active {formatActiveRange(selected)} ·{" "}
              <Link to={`/officers/${encodeURIComponent(selected.id)}`}>View full record</Link>
            </div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleChange} disabled={disabled}>
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="field officer-search-picker">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        placeholder="Start typing a name…"
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {helpText && <span className="field-hint">{helpText}</span>}

      {showDropdown && (
        <ul id={listboxId} role="listbox" className="officer-search-dropdown">
          {loading && (
            <li className="officer-search-status" aria-live="polite">
              Searching…
            </li>
          )}
          {!loading && error && <li className="officer-search-status officer-search-error">{error}</li>}
          {!loading && !error && results.length === 0 && (
            <li className="officer-search-status">No matching officers.</li>
          )}
          {!loading &&
            !error &&
            results.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="officer-search-result"
                  onClick={() => handlePick(candidate)}
                >
                  <span className="officer-search-result-name">
                    {candidate.firstName} {candidate.lastName}
                  </span>
                  <span className="officer-search-result-meta">
                    {formatCandidateMeta(candidate)} · active {formatActiveRange(candidate)}
                  </span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
