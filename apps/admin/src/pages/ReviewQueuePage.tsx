import { useCallback, useEffect, useState } from "react";
import type { ReviewQueueItem } from "@cop/shared-types";
import * as api from "../api/client";
import { ApiError } from "../api/client";
import { ReviewQueueItemCard } from "../components/ReviewQueueItemCard";
import { ErrorBanner } from "../components/ErrorBanner";

export function ReviewQueuePage() {
  const [items, setItems] = useState<ReviewQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "unexpected error";
      throw new Error(`rejection failed: ${message}`);
    }
  }

  return (
    <>
      <h1>Review queue</h1>
      <p className="page-subtitle">Pending candidate officer and incident records awaiting review.</p>

      {error && <ErrorBanner message={error} />}

      {loading && <p>Loading…</p>}

      {!loading && items && items.length === 0 && (
        <div className="empty-state">Nothing pending — the queue is clear.</div>
      )}

      {!loading &&
        items &&
        items.map((item) => (
          <ReviewQueueItemCard key={item.id} item={item} onApprove={handleApprove} onReject={handleReject} />
        ))}
    </>
  );
}
