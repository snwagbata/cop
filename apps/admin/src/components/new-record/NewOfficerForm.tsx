import { useState } from "react";
import type { FormEvent } from "react";
import type { EmploymentStatus } from "@cop/shared-types";
import * as api from "../../api/client";
import type { CreatedDepartment, CreatedOfficer } from "../../api/client";
import { ErrorBanner } from "../ErrorBanner";

const EMPLOYMENT_STATUSES: EmploymentStatus[] = [
  "active",
  "inactive",
  "terminated",
  "resigned",
  "retired",
  "decertified",
];

const empty = {
  firstName: "",
  lastName: "",
  departmentId: "",
  badgeNumber: "",
  rank: "",
  hireDate: "",
  employmentStatus: "active" as EmploymentStatus,
  postCertificationId: "",
  photoUrl: "",
};

interface Props {
  sessionDepartments: CreatedDepartment[];
  onCreated: (officer: CreatedOfficer) => void;
}

/** Department is a free-text id field with a datalist of departments created
 * earlier in this session as a convenience — there's no internal
 * department-search endpoint yet, so a reviewer working with an existing
 * department needs its id from elsewhere (e.g. the public departments list). */
export function NewOfficerForm({ sessionDepartments, onCreated }: Props) {
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<CreatedOfficer | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.firstName.trim() === "" || form.lastName.trim() === "" || form.departmentId.trim() === "") {
      setError("First name, last name, and department ID are required.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.createOfficer({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        departmentId: form.departmentId.trim(),
        badgeNumber: form.badgeNumber.trim() || undefined,
        rank: form.rank.trim() || undefined,
        hireDate: form.hireDate || undefined,
        employmentStatus: form.employmentStatus,
        postCertificationId: form.postCertificationId.trim() || undefined,
        photoUrl: form.photoUrl.trim() || undefined,
      });
      onCreated(res.record);
      setSuccess(res.record);
      setForm(empty);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create officer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={handleSubmit}>
      <h3>New officer</h3>
      {error && <ErrorBanner message={error} />}
      {success && (
        <div className="callout callout-info" role="status">
          Created officer <code>{success.id}</code> — {success.firstName} {success.lastName}.
        </div>
      )}

      <div className="field-row">
        <div className="field">
          <label htmlFor="off-first-name">First name</label>
          <input
            id="off-first-name"
            type="text"
            value={form.firstName}
            onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
            disabled={busy}
          />
        </div>
        <div className="field">
          <label htmlFor="off-last-name">Last name</label>
          <input
            id="off-last-name"
            type="text"
            value={form.lastName}
            onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
            disabled={busy}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="off-department">Department ID</label>
        <input
          id="off-department"
          type="text"
          list="session-departments"
          value={form.departmentId}
          onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
          disabled={busy}
        />
        <datalist id="session-departments">
          {sessionDepartments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </datalist>
        <span className="field-hint">Paste an existing department id, or create one in the Department tab first.</span>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="off-badge">Badge number (optional)</label>
          <input
            id="off-badge"
            type="text"
            value={form.badgeNumber}
            onChange={(e) => setForm((f) => ({ ...f, badgeNumber: e.target.value }))}
            disabled={busy}
          />
        </div>
        <div className="field">
          <label htmlFor="off-rank">Rank (optional)</label>
          <input
            id="off-rank"
            type="text"
            value={form.rank}
            onChange={(e) => setForm((f) => ({ ...f, rank: e.target.value }))}
            disabled={busy}
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="off-hire-date">Hire date (optional)</label>
          <input
            id="off-hire-date"
            type="date"
            value={form.hireDate}
            onChange={(e) => setForm((f) => ({ ...f, hireDate: e.target.value }))}
            disabled={busy}
          />
        </div>
        <div className="field">
          <label htmlFor="off-status">Employment status</label>
          <select
            id="off-status"
            value={form.employmentStatus}
            onChange={(e) => setForm((f) => ({ ...f, employmentStatus: e.target.value as EmploymentStatus }))}
            disabled={busy}
          >
            {EMPLOYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="off-post-id">POST/certification ID (optional)</label>
        <input
          id="off-post-id"
          type="text"
          value={form.postCertificationId}
          onChange={(e) => setForm((f) => ({ ...f, postCertificationId: e.target.value }))}
          disabled={busy}
        />
        <span className="field-hint">
          Primary cross-department match key (DESIGN.md §6) — supply it whenever the source has it.
        </span>
      </div>

      <div className="field">
        <label htmlFor="off-photo">Photo URL (optional)</label>
        <input
          id="off-photo"
          type="url"
          value={form.photoUrl}
          onChange={(e) => setForm((f) => ({ ...f, photoUrl: e.target.value }))}
          disabled={busy}
        />
        <span className="field-hint">
          Only an officially-sourced photo (department release, court exhibit) — never a scraped social photo
          (DESIGN.md §4). Leave blank if unsure.
        </span>
      </div>

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Creating…" : "Create officer"}
      </button>
    </form>
  );
}
