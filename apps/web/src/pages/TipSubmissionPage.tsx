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

// INGESTION_DESIGN.md §3.9 ("Suggest a source" UI framing): this form's
// backend has always accepted a link alongside a firsthand account
// (`externalUrl`, `POST /api/public/tips`), but the UI only ever framed
// itself around "something I witnessed." The toggle below is purely
// presentational — it swaps copy via this lookup, nothing else. Both modes
// submit the exact same fields to submitTip(); see handleSubmit.
type TipMode = "witness" | "document";

const MODE_COPY: Record<
  TipMode,
  {
    toggleLabel: string;
    subtitle: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    externalUrlLabel: string;
    externalUrlPlaceholder: string;
    externalUrlHelp?: string;
  }
> = {
  witness: {
    toggleLabel: "I witnessed this",
    subtitle:
      "Use this form to report a potential incident of officer misconduct you know about — for example, body " +
      "cam or bystander footage, or something you witnessed. This form is completely anonymous: we do not " +
      "collect your name, contact information, or IP address. Every tip is reviewed by a person before " +
      "anything is published; nothing here goes live automatically.",
    descriptionLabel: "What happened?",
    descriptionPlaceholder: "Describe what you saw or know about, as specifically as you can.",
    externalUrlLabel: "Link to footage or a document (optional)",
    externalUrlPlaceholder: "https://…",
  },
  document: {
    toggleLabel: "I found a document about this",
    subtitle:
      "Use this form to point us to a specific document about a potential incident of officer misconduct — a " +
      "court filing, a news article, a FOIA response, or something similar you came across. This form is " +
      "completely anonymous: we do not collect your name, contact information, or IP address. Every submission " +
      "is reviewed by a person before anything is published; nothing here goes live automatically.",
    descriptionLabel: "What does the document show, briefly?",
    descriptionPlaceholder: "Summarize what the document says or shows, as specifically as you can.",
    externalUrlLabel: "Link to the court filing, article, or document",
    externalUrlPlaceholder: "https://…",
    externalUrlHelp: "This is the most useful thing you can give us — a reviewer will read the document directly.",
  },
};

/**
 * Anonymous tip submission form (DESIGN.md §12's "anonymous, source-protected
 * tip intake" backlog item, and §5's footage/tip ingestion row). Unlike
 * DisputeFormPage, this collects no identifying information at all — no
 * name, no role, no way to look up status afterward. Deliberately simpler
 * than the dispute form for that reason.
 */
export function TipSubmissionPage() {
  const [mode, setMode] = useState<TipMode>("witness");
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

  const copy = MODE_COPY[mode];

  return (
    <div>
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Submit a Tip" }]} />
      <h1 className="page-title">Submit a tip</h1>

      <div className="tip-mode-toggle" role="group" aria-label="What kind of tip is this?">
        <button
          type="button"
          className={`btn ${mode === "witness" ? "btn-primary" : "btn-secondary"}`}
          aria-pressed={mode === "witness"}
          onClick={() => setMode("witness")}
        >
          {MODE_COPY.witness.toggleLabel}
        </button>
        <button
          type="button"
          className={`btn ${mode === "document" ? "btn-primary" : "btn-secondary"}`}
          aria-pressed={mode === "document"}
          onClick={() => setMode("document")}
        >
          {MODE_COPY.document.toggleLabel}
        </button>
      </div>

      <p className="subtitle">{copy.subtitle}</p>

      <form className="tip-form" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="description">{copy.descriptionLabel}</label>
          <textarea
            id="description"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={copy.descriptionPlaceholder}
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

        <div className={`field${mode === "document" ? " field-emphasized" : ""}`}>
          <label htmlFor="externalUrl">{copy.externalUrlLabel}</label>
          <input
            id="externalUrl"
            type="url"
            value={externalUrl}
            onChange={(e) => setExternalUrl(e.target.value)}
            placeholder={copy.externalUrlPlaceholder}
          />
          {copy.externalUrlHelp && <p className="field-hint">{copy.externalUrlHelp}</p>}
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
