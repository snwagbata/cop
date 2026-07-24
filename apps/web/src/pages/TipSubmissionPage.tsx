import { useState, type FormEvent } from "react";
import type { IncidentType } from "@cop/shared-types";
import { ApiError, submitTip } from "../lib/apiClient";
import { Breadcrumbs } from "../components/Breadcrumbs";

type SubmitState = { status: "idle" | "submitting" | "done" | "error"; message?: string };

const INCIDENT_TYPE_OPTIONS: { value: IncidentType; label: string }[] = [
  { value: "use_of_force", label: "Use of Force" },
  { value: "false_report", label: "False Report" },
  { value: "unlawful_arrest", label: "Unlawful Arrest" },
  { value: "other", label: "Other / not sure" },
];

/**
 * Anonymous tip submission form (DESIGN.md §12's "anonymous, source-protected
 * tip intake" backlog item, and §5's footage/tip ingestion row). Unlike
 * DisputeFormPage, this collects no identifying information at all — no
 * name, no role, no way to look up status afterward. Deliberately simpler
 * than the dispute form for that reason.
 */
export function TipSubmissionPage() {
  const [description, setDescription] = useState("");
  const [officerNameAsReported, setOfficerNameAsReported] = useState("");
  const [departmentNameAsReported, setDepartmentNameAsReported] = useState("");
  const [incidentType, setIncidentType] = useState<IncidentType>("other");
  const [incidentDateAsReported, setIncidentDateAsReported] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setState({ status: "submitting" });
    try {
      await submitTip({
        description,
        officerNameAsReported: officerNameAsReported.trim() || undefined,
        departmentNameAsReported: departmentNameAsReported.trim() || undefined,
        incidentType,
        incidentDateAsReported: incidentDateAsReported.trim() || undefined,
        externalUrl: externalUrl.trim() || undefined,
      });
      setState({ status: "done" });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Something went wrong submitting this tip. Please try again.";
      setState({ status: "error", message });
    }
  }

  if (state.status === "done") {
    return (
      <div className="success-state">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Submit a Tip" }]} />
        <p>
          Thank you — your tip has been submitted for review. Because this form is anonymous, there's no way to
          check its status or follow up with you directly.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Submit a Tip" }]} />
      <h1 className="page-title">Submit a tip</h1>
      <p className="subtitle">
        Use this form to report a potential incident of officer misconduct you know about — for example, body cam
        or bystander footage, or something you witnessed. This form is completely anonymous: we do not collect
        your name, contact information, or IP address. Every tip is reviewed by a person before anything is
        published; nothing here goes live automatically.
      </p>

      <form className="tip-form" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="description">What happened?</label>
          <textarea
            id="description"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what you saw or know about, as specifically as you can."
          />
        </div>

        <div className="field">
          <label htmlFor="officerNameAsReported">Officer name, if known (optional)</label>
          <input
            id="officerNameAsReported"
            type="text"
            value={officerNameAsReported}
            onChange={(e) => setOfficerNameAsReported(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="departmentNameAsReported">Department, if known (optional)</label>
          <input
            id="departmentNameAsReported"
            type="text"
            value={departmentNameAsReported}
            onChange={(e) => setDepartmentNameAsReported(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="incidentType">Type of incident</label>
          <select
            id="incidentType"
            value={incidentType}
            onChange={(e) => setIncidentType(e.target.value as IncidentType)}
          >
            {INCIDENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="incidentDateAsReported">When did this happen, if known (optional)</label>
          <input
            id="incidentDateAsReported"
            type="text"
            value={incidentDateAsReported}
            onChange={(e) => setIncidentDateAsReported(e.target.value)}
            placeholder="An exact date, or your best guess (e.g. “sometime last spring”)"
          />
        </div>

        <div className="field">
          <label htmlFor="externalUrl">Link to footage or a document (optional)</label>
          <input
            id="externalUrl"
            type="url"
            value={externalUrl}
            onChange={(e) => setExternalUrl(e.target.value)}
            placeholder="https://…"
          />
        </div>

        {state.status === "error" && (
          <div className="error-state" role="alert">
            {state.message}
          </div>
        )}

        <button type="submit" className="btn btn-primary" disabled={state.status === "submitting"}>
          {state.status === "submitting" ? "Submitting…" : "Submit tip"}
        </button>
      </form>
    </div>
  );
}
