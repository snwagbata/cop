import { useState } from "react";
import type { PendingPhotoOfficer } from "@cop/shared-types";

interface Props {
  officer: PendingPhotoOfficer;
  onConfirm: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}

export function PhotoReviewCard({ officer, onConfirm, onReject }: Props) {
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleConfirm() {
    setLocalError(null);
    setBusy(true);
    try {
      await onConfirm(officer.id);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Confirming the photo failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    setLocalError(null);
    setBusy(true);
    try {
      await onReject(officer.id);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Rejecting the photo failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card photo-review-card" data-testid={`photo-review-${officer.id}`}>
      <div className="card-header">
        <img
          src={officer.photoUrl}
          alt={`Submitted photo of ${officer.firstName} ${officer.lastName}`}
          className="photo-review-img"
        />
        <div>
          <div className="card-title">
            {officer.firstName} {officer.lastName}
          </div>
          <dl className="kv-grid">
            <dt>Department</dt>
            <dd>{officer.departmentName}</dd>
            <dt>Badge #</dt>
            <dd>{officer.badgeNumber ?? "—"}</dd>
          </dl>
        </div>
      </div>

      <div className="card-actions">
        <button type="button" className="btn btn-primary" onClick={handleConfirm} disabled={busy}>
          Confirm
        </button>
        <button type="button" className="btn btn-danger" onClick={handleReject} disabled={busy}>
          Reject
        </button>
      </div>

      {localError && (
        <div className="item-error" role="alert">
          {localError}
        </div>
      )}
    </article>
  );
}
