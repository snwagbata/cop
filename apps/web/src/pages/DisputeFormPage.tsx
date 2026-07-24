import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { DisputeRequesterRole } from "@cop/shared-types";
import { ApiError, submitDispute } from "../lib/apiClient";
import { Breadcrumbs } from "../components/Breadcrumbs";

type SubmitState =
  | { status: "idle" | "submitting" | "error"; message?: string }
  | { status: "done"; disputeId?: string };

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
  // Defense in depth, not just trust in our own links: the API requires
  // exactly one of officerId/incidentId/outcomeId (DESIGN.md §10), but these
  // are URL query params — editable directly in the browser bar regardless
  // of what any in-app link generates. If more than one is present, pick
  // deterministically (most specific first) rather than forwarding an
  // invalid combination the API will just reject. (A real bug once reached
  // here: an incident-page link used to include both incidentId and
  // officerId, which always failed server-side — fixed at the link's
  // source in IncidentCard, but this guard means a similar mistake
  // elsewhere can't silently break dispute submission again.)
  const rawOfficerId = params.get("officerId") ?? undefined;
  const rawIncidentId = params.get("incidentId") ?? undefined;
  const rawOutcomeId = params.get("outcomeId") ?? undefined;
  const incidentId = rawIncidentId;
  const outcomeId = !incidentId ? rawOutcomeId : undefined;
  const officerId = !incidentId && !outcomeId ? rawOfficerId : undefined;

  const [requesterName, setRequesterName] = useState("");
  const [requesterRole, setRequesterRole] = useState<DisputeRequesterRole>("subject");
  const [claim, setClaim] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setState({ status: "submitting" });
    try {
      const res = await submitDispute({
        officerId,
        incidentId,
        outcomeId,
        requesterName,
        requesterRole,
        claim,
        evidenceUrl: evidenceUrl.trim() || undefined,
      });
      setState({ status: "done", disputeId: res.dispute.id });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Something went wrong submitting this request. Please try again.";
      setState({ status: "error", message });
    }
  }

  if (state.status === "done") {
    return (
      <div className="success-state">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Correction Request" }]} />
        <p>
          Your correction request has been submitted. We aim to acknowledge every request within 5 business days.
          Resolution notes will be reflected on the relevant record once reviewed.
        </p>
        {state.disputeId && (
          <p>
            Your request id is <code>{state.disputeId}</code>. Save it — you can{" "}
            <Link to={`/disputes/status?id=${encodeURIComponent(state.disputeId)}`}>check its status</Link> at any
            time.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Correction Request" }]} />
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
        <div className="field">
          <label htmlFor="requesterName">Your name</label>
          <input
            id="requesterName"
            required
            type="text"
            value={requesterName}
            onChange={(e) => setRequesterName(e.target.value)}
            autoComplete="name"
          />
        </div>

        <div className="field">
          <label htmlFor="requesterRole">Your role</label>
          <select
            id="requesterRole"
            value={requesterRole}
            onChange={(e) => setRequesterRole(e.target.value as DisputeRequesterRole)}
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="claim">What is inaccurate, and why?</label>
          <textarea
            id="claim"
            required
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            placeholder="Describe specifically what you believe is wrong and what the correct information is."
          />
        </div>

        <div className="field">
          <label htmlFor="evidenceUrl">Link to supporting evidence (optional)</label>
          <input
            id="evidenceUrl"
            type="url"
            value={evidenceUrl}
            onChange={(e) => setEvidenceUrl(e.target.value)}
            placeholder="https://…"
          />
        </div>

        {state.status === "error" && (
          <div className="error-state" role="alert">
            {state.message}
          </div>
        )}

        <button type="submit" className="btn btn-primary" disabled={state.status === "submitting"}>
          {state.status === "submitting" ? "Submitting…" : "Submit request"}
        </button>
      </form>
    </div>
  );
}
