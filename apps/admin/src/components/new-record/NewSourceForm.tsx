import { useState } from "react";
import type { FormEvent } from "react";
import type { ReliabilityTier, SourceType } from "@cop/shared-types";
import * as api from "../../api/client";
import type { CreatedSource } from "../../api/client";
import { ErrorBanner } from "../ErrorBanner";

const SOURCE_TYPES: SourceType[] = [
  "court_doc",
  "news_article",
  "public_records_response",
  "official_dataset",
  "decertification_registry",
];

const RELIABILITY_TIERS: ReliabilityTier[] = [
  "tier1_primary_legal_doc",
  "tier2_official_dataset",
  "tier3_established_news",
  "tier4_submitted_unverified",
];

const empty = {
  sourceType: "news_article" as SourceType,
  url: "",
  publicationDate: "",
  retrievedDate: "",
  reliabilityTier: "tier3_established_news" as ReliabilityTier,
};

export function NewSourceForm({ onCreated }: { onCreated: (source: CreatedSource) => void }) {
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<CreatedSource | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.url.trim() === "") {
      setError("A source URL is required.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.createSource({
        sourceType: form.sourceType,
        url: form.url.trim(),
        publicationDate: form.publicationDate || undefined,
        retrievedDate: form.retrievedDate || undefined,
        reliabilityTier: form.reliabilityTier,
      });
      onCreated(res.record);
      setSuccess(res.record);
      setForm(empty);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create source.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={handleSubmit}>
      <h3>New source</h3>
      <p className="field-hint">
        Cite this source when creating an incident or outcome below. Every record must trace to a source (DESIGN.md
        §3).
      </p>
      {error && <ErrorBanner message={error} />}
      {success && (
        <div className="callout callout-info" role="status">
          Created source <code>{success.id}</code>.
        </div>
      )}

      <div className="field">
        <label htmlFor="source-type">Source type</label>
        <select
          id="source-type"
          value={form.sourceType}
          onChange={(e) => setForm((f) => ({ ...f, sourceType: e.target.value as SourceType }))}
          disabled={busy}
        >
          {SOURCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="source-url">URL</label>
        <input
          id="source-url"
          type="url"
          value={form.url}
          onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
          disabled={busy}
          placeholder="https://…"
        />
      </div>

      <div className="field">
        <label htmlFor="source-reliability">Reliability tier</label>
        <select
          id="source-reliability"
          value={form.reliabilityTier}
          onChange={(e) => setForm((f) => ({ ...f, reliabilityTier: e.target.value as ReliabilityTier }))}
          disabled={busy}
        >
          {RELIABILITY_TIERS.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="source-pub-date">Publication date (optional)</label>
        <input
          id="source-pub-date"
          type="date"
          value={form.publicationDate}
          onChange={(e) => setForm((f) => ({ ...f, publicationDate: e.target.value }))}
          disabled={busy}
        />
      </div>

      <div className="field">
        <label htmlFor="source-retrieved-date">Retrieved date (optional, defaults to today)</label>
        <input
          id="source-retrieved-date"
          type="date"
          value={form.retrievedDate}
          onChange={(e) => setForm((f) => ({ ...f, retrievedDate: e.target.value }))}
          disabled={busy}
        />
      </div>

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Creating…" : "Create source"}
      </button>
    </form>
  );
}
