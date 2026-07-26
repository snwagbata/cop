import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { ReviewDigest } from "@cop/shared-types";
import * as api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { ErrorBanner } from "../components/ErrorBanner";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

/**
 * Weekly-digest landing page (DESIGN.md §7): "12 new candidate records this
 * week, 9 auto-matched with high confidence, 3 need your input." — the
 * whole point is that a reviewer can see, in one glance and before clicking
 * into anything, how much attention this week's session actually needs.
 */
export function DashboardPage() {
  const { reviewer } = useAuth();
  const [digest, setDigest] = useState<ReviewDigest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.fetchReviewDigest();
        if (!cancelled) setDigest(res.digest);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load the weekly digest.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <h1>Welcome{reviewer ? `, ${reviewer.name.split(" ")[0]}` : ""}</h1>
      <p className="page-subtitle">
        Your weekly review snapshot — this is meant to take about 15 minutes (DESIGN.md §7).
      </p>

      {error && <ErrorBanner message={error} />}
      {loading && <p>Loading…</p>}

      {!loading && digest && (
        <>
          <p className="text-muted">
            {formatDate(digest.periodStart)} – {formatDate(digest.periodEnd)}
          </p>
          <div className="stat-grid">
            <div className="stat-tile card">
              <span className="stat-tile-value">{digest.newCount}</span>
              <span className="stat-tile-label">New candidate records this week</span>
            </div>
            <div className="stat-tile card">
              <span className="stat-tile-value stat-tile-value-cleared">{digest.highConfidenceCount}</span>
              <span className="stat-tile-label">Auto-matched, high confidence</span>
            </div>
            <div className="stat-tile card">
              <span className="stat-tile-value stat-tile-value-neutral">{digest.needsAttentionCount}</span>
              <span className="stat-tile-label">Need your input</span>
            </div>
            <div className="stat-tile card">
              <span className="stat-tile-value">{digest.approvedCount}</span>
              <span className="stat-tile-label">Approved this period</span>
            </div>
            <div className="stat-tile card">
              <span className="stat-tile-value">{digest.rejectedCount}</span>
              <span className="stat-tile-label">Rejected this period</span>
            </div>
            <div className="stat-tile card">
              <span className="stat-tile-value stat-tile-value-adverse">{digest.openDisputeCount}</span>
              <span className="stat-tile-label">Open disputes</span>
            </div>
          </div>

          <p className="dashboard-summary">
            <strong>
              {digest.newCount} new candidate record{digest.newCount === 1 ? "" : "s"} this week
            </strong>
            , {digest.highConfidenceCount} auto-matched with high confidence,{" "}
            {digest.needsAttentionCount} need your input.
          </p>
        </>
      )}

      <div className="dashboard-actions">
        <Link to="/review-queue" className="btn btn-primary">
          Go to review queue
        </Link>
        <Link to="/disputes" className="btn btn-secondary">
          View open disputes
        </Link>
        <Link to="/new-record" className="btn btn-secondary">
          Log a new record
        </Link>
      </div>
    </>
  );
}
