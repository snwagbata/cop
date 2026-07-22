import { useState } from "react";
import type { Dispute, DisputeStatus } from "@cop/shared-types";

interface Props {
  dispute: Dispute;
  onResolve: (id: string, status: Exclude<DisputeStatus, "open">, resolutionNotes: string) => Promise<void>;
}

const RESOLUTION_OPTIONS: Array<{ value: Exclude<DisputeStatus, "open">; label: string }> = [
  { value: "resolved_corrected", label: "Resolved — corrected" },
  { value: "resolved_no_change", label: "Resolved — no change" },
  { value: "resolved_removed", label: "Resolved — removed" },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function targetLabel(dispute: Dispute): string {
  if (dispute.incidentId) return `Incident ${dispute.incidentId}`;
  if (dispute.outcomeId) return `Outcome ${dispute.outcomeId}`;
  if (dispute.officerId) return `Officer ${dispute.officerId}`;
  return "Unknown target";
}

export function DisputeCard({ dispute, onResolve }: Props) {
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [status, setStatus] = useState<Exclude<DisputeStatus, "open">>("resolved_corrected");
  const [notes, setNotes] = useState("");
  const [resolving, setResolving] = useState(false);

  async function handleSubmit() {
    if (notes.trim() === "") {
      setLocalError("Resolution notes are required.");
      return;
    }
    setLocalError(null);
    setBusy(true);
    try {
      await onResolve(dispute.id, status, notes.trim());
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Resolving the dispute failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card" data-testid={`dispute-${dispute.id}`}>
      <div className="card-header">
        <div>
          <div className="card-title">
            {dispute.requesterName} <span className="badge badge-type">{dispute.requesterRole}</span>
          </div>
          <div className="note-text">
            Disputing: {targetLabel(dispute)} · submitted {formatDate(dispute.submittedAt)}
          </div>
        </div>
      </div>

      <p style={{ margin: "0.4rem 0" }}>{dispute.claim}</p>

      {dispute.evidenceUrl && (
        <div className="source-line">
          Evidence:{" "}
          <a href={dispute.evidenceUrl} target="_blank" rel="noreferrer">
            {dispute.evidenceUrl}
          </a>
        </div>
      )}

      <div className="card-actions">
        {!resolving ? (
          <button type="button" className="btn btn-primary" onClick={() => setResolving(true)} disabled={busy}>
            Resolve
          </button>
        ) : (
          <div style={{ width: "100%" }}>
            <div className="field">
              <label htmlFor={`status-${dispute.id}`}>Resolution</label>
              <select
                id={`status-${dispute.id}`}
                value={status}
                onChange={(e) => setStatus(e.target.value as Exclude<DisputeStatus, "open">)}
                disabled={busy}
              >
                {RESOLUTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`notes-${dispute.id}`}>Resolution notes</label>
              <textarea
                id={`notes-${dispute.id}`}
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={busy}
                placeholder="What was found, what changed (or didn't), and why."
              />
            </div>
            <div className="inline-form">
              <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={busy}>
                Submit resolution
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setResolving(false);
                  setLocalError(null);
                }}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {localError && <div className="item-error">{localError}</div>}
    </article>
  );
}
