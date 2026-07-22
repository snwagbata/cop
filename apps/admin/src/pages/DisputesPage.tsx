import { useCallback, useEffect, useState } from "react";
import type { Dispute, DisputeStatus } from "@cop/shared-types";
import * as api from "../api/client";
import { ApiError } from "../api/client";
import { DisputeCard } from "../components/DisputeCard";
import { ErrorBanner } from "../components/ErrorBanner";

export function DisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.fetchDisputes("open");
      setDisputes(res.disputes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load disputes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleResolve(id: string, status: Exclude<DisputeStatus, "open">, resolutionNotes: string) {
    try {
      await api.resolveDispute(id, { status, resolutionNotes });
      setDisputes((prev) => (prev ? prev.filter((d) => d.id !== id) : prev));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "unexpected error";
      throw new Error(`resolving dispute failed: ${message}`);
    }
  }

  return (
    <>
      <h1>Disputes</h1>
      <p className="page-subtitle">Open correction/dispute requests from officers, departments, attorneys, or subjects.</p>

      {error && <ErrorBanner message={error} />}

      {loading && <p>Loading…</p>}

      {!loading && disputes && disputes.length === 0 && (
        <div className="empty-state">No open disputes.</div>
      )}

      {!loading &&
        disputes &&
        disputes.map((dispute) => (
          <DisputeCard key={dispute.id} dispute={dispute} onResolve={handleResolve} />
        ))}
    </>
  );
}
