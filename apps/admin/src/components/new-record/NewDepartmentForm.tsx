import { useState } from "react";
import type { FormEvent } from "react";
import * as api from "../../api/client";
import type { CreatedDepartment } from "../../api/client";
import { ErrorBanner } from "../ErrorBanner";

const empty = { name: "", state: "", jurisdictionType: "", contactInfo: "", recordsRequestPortalUrl: "" };

export function NewDepartmentForm({ onCreated }: { onCreated: (dept: CreatedDepartment) => void }) {
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<CreatedDepartment | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.name.trim() === "" || form.state.trim() === "" || form.jurisdictionType.trim() === "") {
      setError("Name, state, and jurisdiction type are required.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.createDepartment({
        name: form.name.trim(),
        state: form.state.trim(),
        jurisdictionType: form.jurisdictionType.trim(),
        contactInfo: form.contactInfo.trim() || undefined,
        recordsRequestPortalUrl: form.recordsRequestPortalUrl.trim() || undefined,
      });
      onCreated(res.record);
      setSuccess(res.record);
      setForm(empty);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create department.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={handleSubmit}>
      <h3>New department</h3>
      <p className="field-hint">
        Only needed if the officer/incident you're logging belongs to a department that isn't already in the
        system.
      </p>
      {error && <ErrorBanner message={error} />}
      {success && (
        <div className="callout callout-info" role="status">
          Created department <code>{success.id}</code> — {success.name}.
        </div>
      )}

      <div className="field">
        <label htmlFor="dept-name">Name</label>
        <input
          id="dept-name"
          type="text"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          disabled={busy}
        />
      </div>
      <div className="field">
        <label htmlFor="dept-state">State</label>
        <input
          id="dept-state"
          type="text"
          placeholder="e.g. CA"
          value={form.state}
          onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
          disabled={busy}
        />
      </div>
      <div className="field">
        <label htmlFor="dept-jurisdiction">Jurisdiction type</label>
        <input
          id="dept-jurisdiction"
          type="text"
          placeholder="e.g. municipal, county sheriff, state police"
          value={form.jurisdictionType}
          onChange={(e) => setForm((f) => ({ ...f, jurisdictionType: e.target.value }))}
          disabled={busy}
        />
      </div>
      <div className="field">
        <label htmlFor="dept-contact">Contact info (optional)</label>
        <input
          id="dept-contact"
          type="text"
          value={form.contactInfo}
          onChange={(e) => setForm((f) => ({ ...f, contactInfo: e.target.value }))}
          disabled={busy}
        />
      </div>
      <div className="field">
        <label htmlFor="dept-portal">Records request portal URL (optional)</label>
        <input
          id="dept-portal"
          type="url"
          value={form.recordsRequestPortalUrl}
          onChange={(e) => setForm((f) => ({ ...f, recordsRequestPortalUrl: e.target.value }))}
          disabled={busy}
        />
      </div>

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Creating…" : "Create department"}
      </button>
    </form>
  );
}
