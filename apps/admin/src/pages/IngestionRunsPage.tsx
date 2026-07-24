import { useCallback, useEffect, useState } from "react";
import type { IngestionRun } from "@cop/shared-types";
import * as api from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { Breadcrumbs } from "../components/Breadcrumbs";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** A run with started_at set but finished_at still null is itself the
 * "something's wrong" signal for an unattended pipeline (INGESTION_DESIGN.md
 * §2/§5) -- surfaced visually, not just as a blank cell. Reuses
 * @cop/design-system's semantic status-badge vocabulary (adverse/cleared/
 * review), same as ReviewQueueItemCard's confidence/tier badges. */
function RunStatusBadge({ run }: { run: IngestionRun }) {
  if (run.error) {
    return <span className="badge badge-adverse">Errored</span>;
  }
  if (!run.finishedAt) {
    return <span className="badge badge-review">In progress</span>;
  }
  return <span className="badge badge-cleared">Completed</span>;
}

/** INGESTION_DESIGN.md §5: "a read-only admin-app page (a read-only table,
 * similar to Audit Log) so a reviewer can see at a glance which pipelines
 * are healthy." No pipeline writes ingestion_runs yet as of this round --
 * the empty state below is the expected, correct state until the first real
 * pipeline (a follow-up build) starts logging runs here. */
export function IngestionRunsPage() {
  const [runs, setRuns] = useState<IngestionRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.fetchIngestionRuns();
      setRuns(res.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ingestion runs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", to: "/" }, { label: "Ingestion Runs" }]} />
      <h1>Ingestion runs</h1>
      <p className="page-subtitle">
        Recent automated pipeline runs (INGESTION_DESIGN.md §2, §5). Every run either finishes with
        fetched/queued/deduped counts, or fails with an error -- a run stuck with no finish time is itself
        a sign something needs attention.
      </p>

      {error && <ErrorBanner message={error} />}
      {loading && <p>Loading…</p>}

      {!loading && runs && runs.length === 0 && (
        <div className="empty-state">
          No ingestion runs yet. This page will populate once an automated pipeline starts running.
        </div>
      )}

      {!loading && runs && runs.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Status</th>
                <th scope="col">Started</th>
                <th scope="col">Finished</th>
                <th scope="col">Fetched</th>
                <th scope="col">Queued</th>
                <th scope="col">Deduped</th>
                <th scope="col">Error</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>{run.sourceType}</td>
                  <td>
                    <RunStatusBadge run={run} />
                  </td>
                  <td>{formatDateTime(run.startedAt)}</td>
                  <td>{formatDateTime(run.finishedAt)}</td>
                  <td>{run.itemsFetched}</td>
                  <td>{run.itemsQueued}</td>
                  <td>{run.itemsDeduped}</td>
                  <td>{run.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
