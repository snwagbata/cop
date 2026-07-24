import { useCallback, useEffect, useState } from "react";
import type { PageInfo, RecordRevision } from "@cop/shared-types";
import * as api from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { Breadcrumbs } from "../components/Breadcrumbs";

const RECORD_TYPES = ["officer", "incident", "outcome", "source"] as const;
const PAGE_SIZE = 25;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function RevisionRow({ revision }: { revision: RecordRevision }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr>
        <td>{revision.recordType}</td>
        <td>{revision.changeType}</td>
        <td>{revision.recordId}</td>
        <td>{revision.changedByReviewerName ?? "—"}</td>
        <td>{formatDateTime(revision.createdAt)}</td>
        <td>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Hide diff" : "Show diff"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6}>
            <pre className="revision-diff">
              {revision.diff ? JSON.stringify(revision.diff, null, 2) : "(no diff recorded)"}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

/** DESIGN.md §3/§7: record_revisions is the project's actual-malice-defense
 * evidence, so reviewers need a way to actually look at it, not just trust
 * that it's being written somewhere. */
export function AuditLogPage() {
  const [revisions, setRevisions] = useState<RecordRevision[] | null>(null);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [recordType, setRecordType] = useState<string>("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.fetchRecordRevisions({
        recordType: recordType || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setRevisions(res.revisions);
      setPageInfo(res.pageInfo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the audit log.");
    } finally {
      setLoading(false);
    }
  }, [recordType, page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = pageInfo ? Math.max(1, Math.ceil(pageInfo.totalCount / pageInfo.pageSize)) : 1;

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", to: "/" }, { label: "Audit Log" }]} />
      <h1>Audit log</h1>
      <p className="page-subtitle">
        Every create, update, approve, reject, and dispute resolution writes a record here (DESIGN.md §3, §7).
      </p>

      <div className="field audit-filter">
        <label htmlFor="record-type-filter">Filter by record type</label>
        <select
          id="record-type-filter"
          value={recordType}
          onChange={(e) => {
            setRecordType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All record types</option>
          {RECORD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading && <p>Loading…</p>}

      {!loading && revisions && revisions.length === 0 && (
        <div className="empty-state">No revisions match this filter.</div>
      )}

      {!loading && revisions && revisions.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Record type</th>
                <th scope="col">Change</th>
                <th scope="col">Record ID</th>
                <th scope="col">Changed by</th>
                <th scope="col">When</th>
                <th scope="col">Diff</th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((r) => (
                <RevisionRow key={r.id} revision={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && pageInfo && totalPages > 1 && (
        <div className="pagination">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className="text-muted">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}
