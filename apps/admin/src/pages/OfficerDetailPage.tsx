import { useEffect, useState } from "react";
import { useParams } from "react-router";
import type { EmploymentStatus, InternalOfficerDetail } from "@cop/shared-types";
import * as api from "../api/client";
import { ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";

const EMPLOYMENT_STATUSES: EmploymentStatus[] = [
  "active",
  "inactive",
  "terminated",
  "resigned",
  "retired",
  "decertified",
];

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: InternalOfficerDetail };

/** Only the fields PATCH /officers/:id actually accepts -- departmentId and
 * hireDate are deliberately excluded, see the design doc §3. */
interface EditForm {
  firstName: string;
  lastName: string;
  badgeNumber: string;
  rank: string;
  employmentStatus: EmploymentStatus;
  postCertificationId: string;
  photoUrl: string;
}

function toEditForm(detail: InternalOfficerDetail): EditForm {
  return {
    firstName: detail.firstName,
    lastName: detail.lastName,
    badgeNumber: detail.badgeNumber ?? "",
    rank: detail.rank ?? "",
    employmentStatus: detail.employmentStatus,
    postCertificationId: detail.postCertificationId ?? "",
    photoUrl: detail.photoUrl ?? "",
  };
}

export function OfficerDetailPage() {
  const { id = "" } = useParams();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    api
      .fetchOfficerDetail(id)
      .then((detail) => {
        if (!cancelled) setState({ status: "ready", detail });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof ApiError ? err.message : "Failed to load this officer.";
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function startEditing(detail: InternalOfficerDetail) {
    setForm(toEditForm(detail));
    setSaveError(null);
    setEditing(true);
  }

  async function handleSave() {
    if (state.status !== "ready" || !form) return;
    setSaving(true);
    setSaveError(null);
    try {
      const original = toEditForm(state.detail);
      const diff: Record<string, unknown> = {};
      if (form.firstName !== original.firstName) diff.firstName = form.firstName.trim();
      if (form.lastName !== original.lastName) diff.lastName = form.lastName.trim();
      if (form.badgeNumber !== original.badgeNumber) diff.badgeNumber = form.badgeNumber.trim() || null;
      if (form.rank !== original.rank) diff.rank = form.rank.trim() || null;
      if (form.employmentStatus !== original.employmentStatus) diff.employmentStatus = form.employmentStatus;
      if (form.postCertificationId !== original.postCertificationId) diff.postCertificationId = form.postCertificationId.trim() || null;
      if (form.photoUrl !== original.photoUrl) diff.photoUrl = form.photoUrl.trim() || null;

      if (Object.keys(diff).length > 0) {
        await api.updateOfficer(id, diff);
        const refreshed = await api.fetchOfficerDetail(id);
        setState({ status: "ready", detail: refreshed });
      }
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  if (state.status === "loading") {
    return <p className="loading-state">Loading officer…</p>;
  }
  if (state.status === "error") {
    return (
      <div className="error-state" role="alert">
        {state.message}
      </div>
    );
  }

  const { detail } = state;

  return (
    <div>
      <h1 className="page-title">
        {detail.firstName} {detail.lastName}
      </h1>
      <p className="page-subtitle">{detail.departmentName}</p>

      {!editing && (
        <button type="button" className="btn btn-secondary" onClick={() => startEditing(detail)}>
          Edit
        </button>
      )}

      {saveError && <ErrorBanner message={saveError} />}

      {!editing && (
        <dl className="kv-grid">
          <dt>Badge #</dt>
          <dd>{detail.badgeNumber ?? "—"}</dd>
          <dt>Rank</dt>
          <dd>{detail.rank ?? "—"}</dd>
          <dt>Employment status</dt>
          <dd>{detail.employmentStatus}</dd>
          <dt>POST/certification ID</dt>
          <dd>{detail.postCertificationId ?? "—"}</dd>
          <dt>Hire date</dt>
          <dd>{detail.hireDate ?? "—"}</dd>
          <dt>Incidents on file</dt>
          <dd>{detail.incidentCount}</dd>
          <dt>Outcomes on file</dt>
          <dd>{detail.outcomeCount}</dd>
        </dl>
      )}

      {editing && form && (
        <div className="card stack">
          <div className="field-row">
            <div className="field">
              <label htmlFor="edit-first-name">First name</label>
              <input
                id="edit-first-name"
                type="text"
                value={form.firstName}
                onChange={(e) => setForm((f) => (f ? { ...f, firstName: e.target.value } : f))}
                disabled={saving}
              />
            </div>
            <div className="field">
              <label htmlFor="edit-last-name">Last name</label>
              <input
                id="edit-last-name"
                type="text"
                value={form.lastName}
                onChange={(e) => setForm((f) => (f ? { ...f, lastName: e.target.value } : f))}
                disabled={saving}
              />
            </div>
          </div>

          <div className="field">
            <span className="field-label-static">Department</span>
            <div>{detail.departmentName}</div>
            <span className="field-hint">
              Changing department requires the transfer officer action (not built yet) so employment history stays
              accurate — not editable here.
            </span>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="edit-badge">Badge number</label>
              <input
                id="edit-badge"
                type="text"
                value={form.badgeNumber}
                onChange={(e) => setForm((f) => (f ? { ...f, badgeNumber: e.target.value } : f))}
                disabled={saving}
              />
            </div>
            <div className="field">
              <label htmlFor="edit-rank">Rank</label>
              <input
                id="edit-rank"
                type="text"
                value={form.rank}
                onChange={(e) => setForm((f) => (f ? { ...f, rank: e.target.value } : f))}
                disabled={saving}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="edit-status">Employment status</label>
            <select
              id="edit-status"
              value={form.employmentStatus}
              onChange={(e) => setForm((f) => (f ? { ...f, employmentStatus: e.target.value as EmploymentStatus } : f))}
              disabled={saving}
            >
              {EMPLOYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="edit-post-id">POST/certification ID</label>
            <input
              id="edit-post-id"
              type="text"
              value={form.postCertificationId}
              onChange={(e) => setForm((f) => (f ? { ...f, postCertificationId: e.target.value } : f))}
              disabled={saving}
            />
          </div>

          <div className="field">
            <label htmlFor="edit-photo">Photo URL</label>
            <input
              id="edit-photo"
              type="url"
              value={form.photoUrl}
              onChange={(e) => setForm((f) => (f ? { ...f, photoUrl: e.target.value } : f))}
              disabled={saving}
            />
            <span className="field-hint">Changing this clears the existing photo confirmation — a reviewer will need to re-confirm it.</span>
          </div>

          <div className="card-actions">
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {detail.departmentHistory.length > 0 && (
        <section className="page-section">
          <h2>Department history</h2>
          <ul className="history-list">
            {detail.departmentHistory.map((h, i) => (
              <li key={i} className="history-item">
                <div className="history-item__dept">
                  {h.departmentName} — badge {h.badgeNumber ?? "unknown"}
                </div>
                <div className="history-item__meta">
                  {h.startDate} – {h.endDate ?? "present"}
                  {h.separationReason ? ` · ${h.separationReason}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
