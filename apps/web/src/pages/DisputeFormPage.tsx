import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { DisputeRequesterRole } from "@cop/shared-types";
import { ApiError, submitDispute } from "../lib/apiClient";

type SubmitState = { status: "idle" | "submitting" | "done" | "error"; message?: string };

const ROLE_OPTIONS: { value: DisputeRequesterRole; label: string }[] = [
  { value: "subject", label: "Subject of the record" },
  { value: "officer", label: "Officer" },
  { value: "department", label: "Department" },
  { value: "attorney", label: "Attorney" },
  { value: "other", label: "Other" },
];

/**
 * Correction / dispute request form (DESIGN.md §10). Posts to
 * POST /api/public/disputes. Reachable from an officer or incident page via
 * a prefilled officerId/incidentId query param, or directly from the site
 * nav for a general request.
 */
export function DisputeFormPage() {
  const [params] = useSearchParams();
  const officerId = params.get("officerId") ?? undefined;
  const incidentId = params.get("incidentId") ?? undefined;
  const outcomeId = params.get("outcomeId") ?? undefined;

  const [requesterName, setRequesterName] = useState("");
  const [requesterRole, setRequesterRole] = useState<DisputeRequesterRole>("subject");
  const [claim, setClaim] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setState({ status: "submitting" });
    try {
      await submitDispute({
        officerId,
        incidentId,
        outcomeId,
        requesterName,
        requesterRole,
        claim,
        evidenceUrl: evidenceUrl.trim() || undefined,
      });
      setState({ status: "done" });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Something went wrong submitting this request. Please try again.";
      setState({ status: "error", message });
    }
  }

  if (state.status === "done") {
    return (
      <div className="success-state">
        Your correction request has been submitted. We aim to acknowledge every request within 5 business days.
        Resolution notes will be reflected on the relevant record once reviewed.
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">Correction / dispute request</h1>
      <p className="subtitle">
        Use this form to dispute an officer record, incident, or outcome you believe is inaccurate. Every
        submission is tracked and reviewed; disputed records are flagged as "under review" rather than silently
        removed while we look into it.
      </p>

      {(officerId || incidentId || outcomeId) && (
        <div className="dispute-context">
          This request will be attached to:
          {officerId && <> officer ID {officerId}</>}
          {incidentId && <> incident ID {incidentId}</>}
          {outcomeId && <> outcome ID {outcomeId}</>}
        </div>
      )}

      <form className="dispute-form" onSubmit={handleSubmit}>
        <label>
          Your name
          <input
            required
            type="text"
            value={requesterName}
            onChange={(e) => setRequesterName(e.target.value)}
            autoComplete="name"
          />
        </label>

        <label>
          Your role
          <select value={requesterRole} onChange={(e) => setRequesterRole(e.target.value as DisputeRequesterRole)}>
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          What is inaccurate, and why?
          <textarea
            required
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            placeholder="Describe specifically what you believe is wrong and what the correct information is."
          />
        </label>

        <label>
          Link to supporting evidence (optional)
          <input
            type="url"
            value={evidenceUrl}
            onChange={(e) => setEvidenceUrl(e.target.value)}
            placeholder="https://…"
          />
        </label>

        {state.status === "error" && (
          <div className="error-state" role="alert">
            {state.message}
          </div>
        )}

        <button type="submit" disabled={state.status === "submitting"}>
          {state.status === "submitting" ? "Submitting…" : "Submit request"}
        </button>
      </form>
    </div>
  );
}
