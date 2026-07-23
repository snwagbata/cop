import { useState } from "react";
import type { FormEvent } from "react";
import type { IncidentStatus, IncidentType, OfficerSearchCandidate } from "@cop/shared-types";
import * as api from "../../api/client";
import type { CreatedDepartment, CreatedIncident, CreatedOfficer, CreatedSource } from "../../api/client";
import { ErrorBanner } from "../ErrorBanner";
import { OfficerSearchPicker } from "../OfficerSearchPicker";

const INCIDENT_TYPES: IncidentType[] = ["use_of_force", "false_report", "unlawful_arrest", "other"];
const STATUSES: IncidentStatus[] = ["alleged", "sustained", "unsustained", "exonerated", "pending", "disputed"];

interface SelectedOfficer {
  id: string;
  label: string;
}

interface Props {
  sessionDepartments: CreatedDepartment[];
  sessionOfficers: CreatedOfficer[];
  sessionSources: CreatedSource[];
  onCreated: (incident: CreatedIncident) => void;
}

export function NewIncidentForm({ sessionDepartments, sessionOfficers, sessionSources, onCreated }: Props) {
  const [departmentId, setDepartmentId] = useState("");
  const [date, setDate] = useState("");
  const [incidentType, setIncidentType] = useState<IncidentType>("use_of_force");
  const [status, setStatus] = useState<IncidentStatus>("alleged");
  const [shortDescription, setShortDescription] = useState("");
  const [officers, setOfficers] = useState<SelectedOfficer[]>([]);
  const [sourceIds, setSourceIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<CreatedIncident | null>(null);
  const [pickerKey, setPickerKey] = useState(0);

  function addOfficer(candidate: OfficerSearchCandidate) {
    setOfficers((prev) =>
      prev.some((o) => o.id === candidate.id)
        ? prev
        : [...prev, { id: candidate.id, label: `${candidate.firstName} ${candidate.lastName} — ${candidate.departmentName}` }],
    );
    // remount the picker so it goes back to an empty search box, ready for
    // the next officer, rather than showing a "selected" state (multi mode).
    setPickerKey((k) => k + 1);
  }

  function addSessionOfficer(o: CreatedOfficer) {
    setOfficers((prev) => (prev.some((x) => x.id === o.id) ? prev : [...prev, { id: o.id, label: `${o.firstName} ${o.lastName} (just created)` }]));
  }

  function removeOfficer(id: string) {
    setOfficers((prev) => prev.filter((o) => o.id !== id));
  }

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
    if (departmentId.trim() === "" || date === "" || shortDescription.trim() === "") {
      setError("Department, date, and description are required.");
      return;
    }
    if (officers.length === 0) {
      setError("Add at least one officer (search-and-select above) before submitting.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.createIncident({
        departmentId: departmentId.trim(),
        date,
        incidentType,
        status,
        shortDescription: shortDescription.trim(),
        officerIds: officers.map((o) => o.id),
        sourceIds: sourceIds.size > 0 ? Array.from(sourceIds) : undefined,
      });
      onCreated(res.record);
      setSuccess(res.record);
      setDepartmentId("");
      setDate("");
      setShortDescription("");
      setOfficers([]);
      setSourceIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create incident.");
    } finally {
      setBusy(false);
    }
  }

  const unaddedSessionOfficers = sessionOfficers.filter((o) => !officers.some((x) => x.id === o.id));

  return (
    <form className="card stack" onSubmit={handleSubmit}>
      <h3>New incident</h3>
      {error && <ErrorBanner message={error} />}
      {success && (
        <div className="callout callout-info" role="status">
          Created incident <code>{success.id}</code>.
        </div>
      )}

      <div className="field">
        <label htmlFor="inc-department">Department ID</label>
        <input
          id="inc-department"
          type="text"
          list="session-departments-incident"
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          disabled={busy}
        />
        <datalist id="session-departments-incident">
          {sessionDepartments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </datalist>
      </div>

      <fieldset className="field officer-picker-fieldset">
        <legend>Officer(s) involved</legend>
        {officers.length > 0 && (
          <ul className="chip-list">
            {officers.map((o) => (
              <li key={o.id} className="chip">
                {o.label}
                <button
                  type="button"
                  className="chip-remove"
                  onClick={() => removeOfficer(o.id)}
                  disabled={busy}
                  aria-label={`Remove ${o.label}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <OfficerSearchPicker
          key={pickerKey}
          id="incident-officer-search"
          label="Search for an officer to add"
          mode="multi"
          disabled={busy}
          onSelect={addOfficer}
        />
        {unaddedSessionOfficers.length > 0 && (
          <div className="quick-add-row">
            <span className="field-hint">Quick-add from officers created this session:</span>
            {unaddedSessionOfficers.map((o) => (
              <button
                key={o.id}
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => addSessionOfficer(o)}
                disabled={busy}
              >
                + {o.firstName} {o.lastName}
              </button>
            ))}
          </div>
        )}
      </fieldset>

      <div className="field-row">
        <div className="field">
          <label htmlFor="inc-type">Incident type</label>
          <select id="inc-type" value={incidentType} onChange={(e) => setIncidentType(e.target.value as IncidentType)} disabled={busy}>
            {INCIDENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="inc-status">Status</label>
          <select id="inc-status" value={status} onChange={(e) => setStatus(e.target.value as IncidentStatus)} disabled={busy}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="inc-date">Date</label>
          <input id="inc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="inc-description">Short description</label>
        <textarea
          id="inc-description"
          rows={3}
          value={shortDescription}
          onChange={(e) => setShortDescription(e.target.value)}
          disabled={busy}
        />
        <span className="field-hint">
          Neutral, source-derived language. Redact/genericize civilian names ("the complainant," "a bystander")
          unless independently named as a party in the source document (DESIGN.md §3, §4).
        </span>
      </div>

      <fieldset className="field">
        <legend>Cite source(s)</legend>
        {sessionSources.length === 0 ? (
          <span className="field-hint">No sources created yet this session — create one in the Source tab first.</span>
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
        {busy ? "Creating…" : "Create incident"}
      </button>
    </form>
  );
}
