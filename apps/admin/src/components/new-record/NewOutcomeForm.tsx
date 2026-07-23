import { useState } from "react";
import type { FormEvent } from "react";
import type { OutcomeType } from "@cop/shared-types";
import * as api from "../../api/client";
import type { CreatedIncident, CreatedOutcome, CreatedSource } from "../../api/client";
import { ErrorBanner } from "../ErrorBanner";

const OUTCOME_TYPES: OutcomeType[] = [
  "internal_discipline",
  "termination",
  "DA_declination",
  "lawsuit_settlement",
  "lawsuit_dismissed",
  "criminal_charges_officer",
  "no_action",
];

interface Props {
  sessionIncidents: CreatedIncident[];
  sessionSources: CreatedSource[];
  onCreated: (outcome: CreatedOutcome) => void;
}

/** Outcomes are optional (task spec) — only useful once at least one
 * incident exists to attach to, so this tab leans on the incident-just-
 * created session cache rather than a GET /incidents list endpoint. */
export function NewOutcomeForm({ sessionIncidents, sessionSources, onCreated }: Props) {
  const [incidentId, setIncidentId] = useState("");
  const [outcomeType, setOutcomeType] = useState<OutcomeType>("internal_discipline");
  const [date, setDate] = useState("");
  const [amountDollars, setAmountDollars] = useState("");
  const [details, setDetails] = useState("");
  const [sourceIds, setSourceIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<CreatedOutcome | null>(null);

  function toggleSource(id: string) {
    setSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (incidentId.trim() === "") {
      setError("An incident ID is required — create or pick one above.");
      return;
    }
    let amountCents: number | undefined;
    if (amountDollars.trim() !== "") {
      const parsed = Number(amountDollars);
      if (Number.isNaN(parsed) || parsed < 0) {
        setError("Amount must be a non-negative number (in dollars).");
        return;
      }
      amountCents = Math.round(parsed * 100);
    }
    setBusy(true);
    try {
      const res = await api.createOutcome({
        incidentId: incidentId.trim(),
        outcomeType,
        date: date || undefined,
        amountCents,
        details: details.trim() || undefined,
        sourceIds: sourceIds.size > 0 ? Array.from(sourceIds) : undefined,
      });
      onCreated(res.record);
      setSuccess(res.record);
      setIncidentId("");
      setDate("");
      setAmountDollars("");
      setDetails("");
      setSourceIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create outcome.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={handleSubmit}>
      <h3>New outcome (optional)</h3>
      <p className="field-hint">
        Attach a discipline/lawsuit/declination outcome to an incident. Skip this tab if the incident doesn't have a
        resolved outcome yet.
      </p>
      {error && <ErrorBanner message={error} />}
      {success && (
        <div className="callout callout-info" role="status">
          Created outcome <code>{success.id}</code>.
        </div>
      )}

      <div className="field">
        <label htmlFor="out-incident">Incident ID</label>
        <input
          id="out-incident"
          type="text"
          list="session-incidents"
          value={incidentId}
          onChange={(e) => setIncidentId(e.target.value)}
          disabled={busy}
        />
        <datalist id="session-incidents">
          {sessionIncidents.map((i) => (
            <option key={i.id} value={i.id}>
              {i.shortDescription.slice(0, 60)}
            </option>
          ))}
        </datalist>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="out-type">Outcome type</label>
          <select id="out-type" value={outcomeType} onChange={(e) => setOutcomeType(e.target.value as OutcomeType)} disabled={busy}>
            {OUTCOME_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="out-date">Date (optional)</label>
          <input id="out-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
        </div>
        <div className="field">
          <label htmlFor="out-amount">Amount, USD (optional)</label>
          <input
            id="out-amount"
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 25000"
            value={amountDollars}
            onChange={(e) => setAmountDollars(e.target.value)}
            disabled={busy}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="out-details">Details (optional)</label>
        <textarea id="out-details" rows={2} value={details} onChange={(e) => setDetails(e.target.value)} disabled={busy} />
      </div>

      <fieldset className="field">
        <legend>Cite source(s) (optional — inherits none by default, per DESIGN.md §4 outcomes carry their own citation)</legend>
        {sessionSources.length === 0 ? (
          <span className="field-hint">No sources created yet this session.</span>
        ) : (
          <ul className="checkbox-list">
            {sessionSources.map((s) => (
              <li key={s.id}>
                <label>
                  <input type="checkbox" checked={sourceIds.has(s.id)} onChange={() => toggleSource(s.id)} disabled={busy} />
                  {s.url}
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Creating…" : "Create outcome"}
      </button>
    </form>
  );
}
