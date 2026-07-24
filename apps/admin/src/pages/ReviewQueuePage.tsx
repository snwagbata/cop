import { useCallback, useEffect, useMemo, useState } from "react";
import type { BulkApproveResponse, ReviewQueueItem } from "@cop/shared-types";
import * as api from "../api/client";
import { ApiError } from "../api/client";
import { ReviewQueueItemCard } from "../components/ReviewQueueItemCard";
import { ErrorBanner } from "../components/ErrorBanner";
import { Breadcrumbs } from "../components/Breadcrumbs";

export function ReviewQueuePage() {
  const [items, setItems] = useState<ReviewQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkApproveResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.fetchReviewQueue("pending");
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the review queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleApprove(id: string, edits?: Record<string, unknown>) {
    try {
      await api.approveReviewQueueItem(id, { edits });
      setItems((prev) => (prev ? prev.filter((it) => it.id !== id) : prev));
      setSelectedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err) {
      // Re-throw with a clear prefix so the card can surface it inline
      // ("approval failed: department not found" style messaging).
      const message = err instanceof ApiError ? err.message : "unexpected error";
      throw new Error(`approval failed: ${message}`);
    }
  }

  async function handleReject(id: string, reason: string) {
    try {
      await api.rejectReviewQueueItem(id, { reason });
      setItems((prev) => (prev ? prev.filter((it) => it.id !== id) : prev));
      setSelectedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "unexpected error";
      throw new Error(`rejection failed: ${message}`);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (!items) return;
    setSelectedIds((prev) => (prev.size === items.length ? new Set() : new Set(items.map((it) => it.id))));
  }

  async function handleBulkApprove() {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    setBulkResult(null);
    setError(null);
    try {
      const res = await api.bulkApproveReviewQueueItems({ reviewQueueIds: Array.from(selectedIds) });
      setBulkResult(res);
      const approvedSet = new Set(res.approved);
      setItems((prev) => (prev ? prev.filter((it) => !approvedSet.has(it.id)) : prev));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of res.approved) next.delete(id);
        return next;
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "unexpected error";
      setError(`bulk approve failed: ${message}`);
    } finally {
      setBulkBusy(false);
    }
  }

  const allSelected = useMemo(
    () => !!items && items.length > 0 && selectedIds.size === items.length,
    [items, selectedIds],
  );

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", to: "/" }, { label: "Review Queue" }]} />
      <h1>Review queue</h1>
      <p className="page-subtitle">Pending candidate officer and incident records awaiting review.</p>

      {error && <ErrorBanner message={error} />}

      {bulkResult && (
        <div className="callout callout-info" role="status">
          <strong>Bulk approve:</strong> {bulkResult.approved.length} approved
          {bulkResult.failed.length > 0 && <>, {bulkResult.failed.length} failed</>}.
          {bulkResult.failed.length > 0 && (
            <ul className="bulk-failed-list">
              {bulkResult.failed.map((f) => (
                <li key={f.id}>
                  {f.id}: {f.error}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ marginTop: "var(--space-2)" }}
            onClick={() => setBulkResult(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {loading && <p>Loading…</p>}

      {!loading && items && items.length === 0 && (
        <div className="empty-state">Nothing pending — the queue is clear.</div>
      )}

      {!loading && items && items.length > 0 && (
        <div className="bulk-toolbar">
          <label className="bulk-toolbar-select-all">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
            Select all ({items.length})
          </label>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={selectedIds.size === 0 || bulkBusy}
            onClick={handleBulkApprove}
          >
            {bulkBusy ? "Approving…" : `Bulk approve selected (${selectedIds.size})`}
          </button>
        </div>
      )}

      {!loading &&
        items &&
        items.map((item) => (
          <ReviewQueueItemCard
            key={item.id}
            item={item}
            onApprove={handleApprove}
            onReject={handleReject}
            selectable
            selected={selectedIds.has(item.id)}
            onToggleSelected={toggleSelected}
          />
        ))}
    </>
  );
}
