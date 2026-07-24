import { useCallback, useEffect, useState } from "react";
import type { PendingPhotoOfficer } from "@cop/shared-types";
import * as api from "../api/client";
import { ApiError } from "../api/client";
import { PhotoReviewCard } from "../components/PhotoReviewCard";
import { ErrorBanner } from "../components/ErrorBanner";
import { Breadcrumbs } from "../components/Breadcrumbs";

/**
 * DESIGN.md §7's photo-confirmation gate: "photo_url is never auto-
 * approved, even from a tier1 source -- a reviewer must positively confirm
 * the photo matches the officer being published." This page is where that
 * confirmation happens -- every officer with a photo_url set but not yet
 * confirmed shows up here until a reviewer confirms or rejects it.
 */
export function PhotoReviewPage() {
  const [officers, setOfficers] = useState<PendingPhotoOfficer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.fetchPendingPhotos();
      setOfficers(res.officers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pending photos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleConfirm(id: string) {
    try {
      await api.confirmOfficerPhoto(id);
      setOfficers((prev) => (prev ? prev.filter((o) => o.id !== id) : prev));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "unexpected error";
      throw new Error(`confirming photo failed: ${message}`);
    }
  }

  async function handleReject(id: string) {
    try {
      await api.rejectOfficerPhoto(id);
      setOfficers((prev) => (prev ? prev.filter((o) => o.id !== id) : prev));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "unexpected error";
      throw new Error(`rejecting photo failed: ${message}`);
    }
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", to: "/" }, { label: "Photo Review" }]} />
      <h1>Photo review</h1>
      <p className="page-subtitle">
        Officer photos awaiting confirmation before they can appear on the public site (DESIGN.md §7).
      </p>

      {error && <ErrorBanner message={error} />}

      {loading && <p>Loading…</p>}

      {!loading && officers && officers.length === 0 && (
        <div className="empty-state">Nothing pending — no photos awaiting review.</div>
      )}

      {!loading &&
        officers &&
        officers.map((officer) => (
          <PhotoReviewCard key={officer.id} officer={officer} onConfirm={handleConfirm} onReject={handleReject} />
        ))}
    </>
  );
}
