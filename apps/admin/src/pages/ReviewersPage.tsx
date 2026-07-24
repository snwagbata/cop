import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Reviewer } from "@cop/shared-types";
import * as api from "../api/client";
import { ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { Breadcrumbs } from "../components/Breadcrumbs";

const emptyForm = { name: "", email: "", role: "reviewer" as "admin" | "reviewer", password: "" };

/**
 * Admin-only reviewer management (DESIGN.md §7's reviewer group is small
 * and trusted, but still needs someone able to add/deactivate accounts
 * without a database console). Route is guarded in App.tsx by role; this
 * page also treats a 403 from the API as the real backstop, not just the
 * UI guard/hidden nav link.
 */
export function ReviewersPage() {
  const [reviewers, setReviewers] = useState<Reviewer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.fetchReviewers();
      setReviewers(res.reviewers);
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 403
          ? "Your account isn't authorized to manage reviewers."
          : err instanceof Error
            ? err.message
            : "Failed to load reviewers.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    if (form.name.trim() === "" || form.email.trim() === "" || form.password.length < 8) {
      setFormError("Name, email, and an 8+ character password are all required.");
      return;
    }
    setFormBusy(true);
    try {
      const created = await api.createReviewer({
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        password: form.password,
      });
      setReviewers((prev) => (prev ? [...prev, created] : [created]));
      setForm(emptyForm);
      setFormSuccess(`Added ${created.name ?? form.name} (${form.role}).`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to add reviewer.");
    } finally {
      setFormBusy(false);
    }
  }

  async function handleRoleChange(id: string, role: "admin" | "reviewer") {
    setRowBusyId(id);
    setRowError(null);
    try {
      const updated = await api.updateReviewer(id, { role });
      setReviewers((prev) => (prev ? prev.map((r) => (r.id === id ? { ...r, ...updated } : r)) : prev));
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Failed to update role.");
    } finally {
      setRowBusyId(null);
    }
  }

  async function handleToggleActive(reviewer: Reviewer) {
    setRowBusyId(reviewer.id);
    setRowError(null);
    try {
      const updated = await api.updateReviewer(reviewer.id, { active: !reviewer.active });
      setReviewers((prev) =>
        prev ? prev.map((r) => (r.id === reviewer.id ? { ...r, ...updated } : r)) : prev,
      );
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Failed to update reviewer status.");
    } finally {
      setRowBusyId(null);
    }
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", to: "/" }, { label: "Reviewers" }]} />
      <h1>Reviewers</h1>
      <p className="page-subtitle">Admin-only: add reviewer accounts, change roles, deactivate access.</p>

      {error && <ErrorBanner message={error} />}
      {rowError && <ErrorBanner message={rowError} />}

      {loading && <p>Loading…</p>}

      {!loading && reviewers && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reviewers.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.email}</td>
                  <td>
                    <label className="visually-hidden" htmlFor={`role-${r.id}`}>
                      Role for {r.name}
                    </label>
                    <select
                      id={`role-${r.id}`}
                      value={r.role}
                      disabled={rowBusyId === r.id}
                      onChange={(e) => handleRoleChange(r.id, e.target.value as "admin" | "reviewer")}
                    >
                      <option value="reviewer">reviewer</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>
                    <span className={`badge ${r.active ? "badge-cleared" : "badge-adverse"}`}>
                      {r.active ? "active" : "deactivated"}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={rowBusyId === r.id}
                      onClick={() => handleToggleActive(r)}
                    >
                      {r.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ marginTop: "var(--space-8)" }}>Add a reviewer</h2>
      <form className="card stack" onSubmit={handleCreate} style={{ maxWidth: 420 }}>
        {formError && <ErrorBanner message={formError} />}
        {formSuccess && (
          <div className="callout callout-info" role="status">
            {formSuccess}
          </div>
        )}
        <div className="field">
          <label htmlFor="new-reviewer-name">Name</label>
          <input
            id="new-reviewer-name"
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            disabled={formBusy}
          />
        </div>
        <div className="field">
          <label htmlFor="new-reviewer-email">Email</label>
          <input
            id="new-reviewer-email"
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            disabled={formBusy}
          />
        </div>
        <div className="field">
          <label htmlFor="new-reviewer-role">Role</label>
          <select
            id="new-reviewer-role"
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as "admin" | "reviewer" }))}
            disabled={formBusy}
          >
            <option value="reviewer">reviewer</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="new-reviewer-password">Temporary password</label>
          <input
            id="new-reviewer-password"
            type="password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            disabled={formBusy}
            minLength={8}
          />
          <span className="field-hint">At least 8 characters. Share it out of band.</span>
        </div>
        <button type="submit" className="btn btn-primary" disabled={formBusy}>
          {formBusy ? "Adding…" : "Add reviewer"}
        </button>
      </form>
    </>
  );
}
