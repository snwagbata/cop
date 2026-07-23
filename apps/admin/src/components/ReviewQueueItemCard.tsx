import { useState } from "react";
import type { OfficerSearchCandidate, ReviewQueueItem } from "@cop/shared-types";
import { OfficerSearchPicker } from "./OfficerSearchPicker";

interface Props {
  item: ReviewQueueItem;
  onApprove: (id: string, edits?: Record<string, unknown>) => Promise<void>;
  onReject: (id: string, reason: string) => Promise<void>;
  /** Bulk-select support for the review-queue page's "bulk approve" action. Optional so
   * this card can still be used/tested standalone without wiring selection up. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelected?: (id: string) => void;
}

const TIER_LABEL: Record<string, string> = {
  tier1_primary_legal_doc: "Tier 1 — primary legal doc",
  tier2_official_dataset: "Tier 2 — official dataset",
  tier3_established_news: "Tier 3 — established news",
  tier4_submitted_unverified: "Tier 4 — submitted/unverified",
};

// Reuses @cop/design-system's semantic status-badge vocabulary (adverse/
// cleared/neutral/review) rather than one-off tier/confidence colors, so
// "how trustworthy is this" reads the same way it does on the public site.
const TIER_BADGE_CLASS: Record<string, string> = {
  tier1_primary_legal_doc: "badge-cleared",
  tier2_official_dataset: "badge-cleared",
  tier3_established_news: "badge-neutral",
  tier4_submitted_unverified: "badge-adverse",
};

const CONFIDENCE_BADGE_CLASS: Record<string, string> = {
  high: "badge-cleared",
  medium: "badge-neutral",
  low: "badge-adverse",
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "unknown date";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

export function ReviewQueueItemCard({
  item,
  onApprove,
  onReject,
  selectable = false,
  selected = false,
  onToggleSelected,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [resolvedOfficer, setResolvedOfficer] = useState<OfficerSearchCandidate | null>(null);

  const { proposedRecord: rec, source, matchConfidence } = item;

  const needsOfficerId = rec.type === "incident_candidate" && !rec.officerId;

  async function handleApprove() {
    setLocalError(null);
    if (needsOfficerId && !resolvedOfficer) {
      setLocalError("Search for and select the officer before approving — this incident isn't matched yet.");
      return;
    }
    setBusy(true);
    try {
      const edits = needsOfficerId ? { officerId: resolvedOfficer!.id } : undefined;
      await onApprove(item.id, edits);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Approval failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (!rejecting) {
      setRejecting(true);
      return;
    }
    if (reason.trim() === "") {
      setLocalError("A short reason is required to reject.");
      return;
    }
    setLocalError(null);
    setBusy(true);
    try {
      await onReject(item.id, reason.trim());
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Rejection failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card review-item-card" data-testid={`review-item-${item.id}`}>
      <div className="card-header">
        {selectable && (
          <label className="review-item-select">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelected?.(item.id)}
              aria-label={`Select ${renderTitle(rec)} for bulk approve`}
            />
          </label>
        )}
        <div>
          <div className="card-title">{renderTitle(rec)}</div>
          <span className="badge badge-review">{rec.type === "officer_candidate" ? "New officer" : "New incident"}</span>{" "}
          <span className={`badge ${CONFIDENCE_BADGE_CLASS[matchConfidence] ?? "badge-neutral"}`}>
            match: {matchConfidence}
          </span>
        </div>
      </div>

      {renderDetails(rec)}

      <div className="source-line">
        {source ? (
          <>
            Source:{" "}
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.url}
            </a>{" "}
            <span className={`badge ${TIER_BADGE_CLASS[source.reliabilityTier] ?? "badge-neutral"}`}>
              {TIER_LABEL[source.reliabilityTier] ?? source.reliabilityTier}
            </span>
          </>
        ) : (
          <em>No source attached.</em>
        )}
      </div>

      <div className="note-text">Submitted {formatDate(item.createdAt)}</div>

      {needsOfficerId && (
        <div className="callout callout-info officer-resolve-callout">
          This incident isn't matched to an existing officer yet. Search for them below to resolve it before
          approving.
          <OfficerSearchPicker
            id={`officer-picker-${item.id}`}
            label="Search for the officer"
            mode="single"
            disabled={busy}
            onSelect={(candidate) => {
              setResolvedOfficer(candidate);
              setLocalError(null);
            }}
            onClear={() => setResolvedOfficer(null)}
          />
        </div>
      )}

      <div className="card-actions">
        <button type="button" className="btn btn-primary" onClick={handleApprove} disabled={busy}>
          Approve
        </button>

        {!rejecting ? (
          <button type="button" className="btn btn-danger" onClick={handleReject} disabled={busy}>
            Reject
          </button>
        ) : (
          <div className="inline-form">
            <label className="visually-hidden" htmlFor={`reject-reason-${item.id}`}>
              Reason for rejection
            </label>
            <input
              id={`reject-reason-${item.id}`}
              type="text"
              placeholder="Reason for rejection"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
              autoFocus
            />
            <button type="button" className="btn btn-danger" onClick={handleReject} disabled={busy}>
              Confirm reject
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setRejecting(false);
                setReason("");
                setLocalError(null);
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {localError && (
        <div className="item-error" role="alert">
          {localError}
        </div>
      )}
    </article>
  );
}

function renderTitle(rec: ReviewQueueItem["proposedRecord"]): string {
  if (rec.type === "officer_candidate") {
    return `${rec.firstName ?? "?"} ${rec.lastName ?? "?"} — ${rec.departmentName ?? "unknown department"}`;
  }
  const who = rec.officerName ?? (rec.officerId ? `officer ${rec.officerId}` : "unmatched officer");
  return `Incident: ${who} — ${rec.departmentName ?? "unknown department"}`;
}

function renderDetails(rec: ReviewQueueItem["proposedRecord"]) {
  if (rec.type === "officer_candidate") {
    return (
      <dl className="kv-grid">
        <dt>Badge #</dt>
        <dd>{rec.badgeNumber ?? "—"}</dd>
        <dt>POST/certification ID</dt>
        <dd>{rec.postCertificationId ?? "—"}</dd>
        {rec.note && (
          <>
            <dt>Note</dt>
            <dd>{rec.note}</dd>
          </>
        )}
      </dl>
    );
  }

  return (
    <dl className="kv-grid">
      <dt>Incident type</dt>
      <dd>{rec.incidentType ? rec.incidentType.replace(/_/g, " ") : "— (missing from source record)"}</dd>
      <dt>Date</dt>
      <dd>{rec.date ? formatDate(rec.date) : "—"}</dd>
      <dt>Officer match</dt>
      <dd>{rec.officerId ? `matched (${rec.officerId})` : rec.officerName ? `${rec.officerName} (unmatched)` : "unmatched"}</dd>
      <dt>Description</dt>
      <dd>{rec.shortDescription ?? "— (missing from source record)"}</dd>
      {rec.note && (
        <>
          <dt>Note</dt>
          <dd>{rec.note}</dd>
        </>
      )}
    </dl>
  );
}
