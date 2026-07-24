import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { DisputeStatusResponse } from "@cop/shared-types";
import { ApiError, getDisputeStatus } from "../lib/apiClient";
import { formatDate, label } from "../lib/format";
import { Breadcrumbs } from "../components/Breadcrumbs";

type LookupState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: DisputeStatusResponse };

/**
 * Dispute status-check page (task item 3). Deliberately asks only for the
 * dispute id — the id itself is the access control here (see
 * DisputeStatusResponse's doc comment in shared-types), so this page never
 * asks for or displays requester identity/claim details.
 */
export function DisputeStatusPage() {
  const [params] = useSearchParams();
  const [id, setId] = useState(params.get("id") ?? "");
  const [state, setState] = useState<LookupState>({ status: "idle" });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = id.trim();
    if (!trimmed) return;
    setState({ status: "loading" });
    try {
      const result = await getDisputeStatus(trimmed);
      setState({ status: "ready", result });
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 404
          ? "No correction request found for that id. Double-check it matches exactly what you were given at submission."
          : err instanceof ApiError
            ? err.message
            : "Something went wrong looking up this request. Please try again.";
      setState({ status: "error", message });
    }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Check Dispute Status" }]} />
      <h1 className="page-title">Check a correction request's status</h1>
      <p className="subtitle">
        Enter the request id you were given when you submitted a correction/dispute request to look up its current
        status.
      </p>

      <form className="dispute-status-form" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="disputeId">Request id</label>
          <input
            id="disputeId"
            type="text"
            required
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="e.g. 3f2a1c9e-…"
            autoComplete="off"
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={state.status === "loading"}>
          {state.status === "loading" ? "Checking…" : "Check status"}
        </button>
      </form>

      {state.status === "error" && (
        <div className="error-state" role="alert">
          {state.message}
        </div>
      )}

      {state.status === "ready" && (
        <div className="card dispute-status-result">
          <dl>
            <dt>Request id</dt>
            <dd>
              <code>{state.result.id}</code>
            </dd>
            <dt>Status</dt>
            <dd>{label(state.result.status)}</dd>
            <dt>Submitted</dt>
            <dd>{formatDate(state.result.submittedAt)}</dd>
            <dt>Resolved</dt>
            <dd>{state.result.resolvedAt ? formatDate(state.result.resolvedAt) : "Not yet resolved"}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
