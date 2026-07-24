import { useState } from "react";
import type {
  CreatedDepartment,
  CreatedIncident,
  CreatedOfficer,
  CreatedOutcome,
  CreatedSource,
} from "../api/client";
import { NewSourceForm } from "../components/new-record/NewSourceForm";
import { NewDepartmentForm } from "../components/new-record/NewDepartmentForm";
import { NewOfficerForm } from "../components/new-record/NewOfficerForm";
import { NewIncidentForm } from "../components/new-record/NewIncidentForm";
import { NewOutcomeForm } from "../components/new-record/NewOutcomeForm";
import { Breadcrumbs } from "../components/Breadcrumbs";

const TABS = [
  { id: "source", label: "1. Source" },
  { id: "department", label: "2. Department" },
  { id: "officer", label: "3. Officer" },
  { id: "incident", label: "4. Incident" },
  { id: "outcome", label: "5. Outcome" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * Reviewer-authored manual entry (DESIGN.md Phase 1), which the review-queue
 * MVP never built. Not a single seamless wizard — five independent forms
 * reachable from one page, chained by a lightweight session-local cache
 * (created sources/departments/officers/incidents feed the next form's
 * pickers/datalists) since there's no GET-existing-records endpoint yet for
 * most of these (see report / README for the source-list-endpoint gap
 * specifically).
 */
export function NewRecordPage() {
  const [activeTab, setActiveTab] = useState<TabId>("source");
  const [sessionSources, setSessionSources] = useState<CreatedSource[]>([]);
  const [sessionDepartments, setSessionDepartments] = useState<CreatedDepartment[]>([]);
  const [sessionOfficers, setSessionOfficers] = useState<CreatedOfficer[]>([]);
  const [sessionIncidents, setSessionIncidents] = useState<CreatedIncident[]>([]);

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", to: "/" }, { label: "New Record" }]} />
      <h1>Log a new record</h1>
      <p className="page-subtitle">
        Reviewer-authored manual entry, for records that didn't come through an ingestion pipeline. Every write here
        goes through the same review-queue-adjacent audit trail as an approval (DESIGN.md §3).
      </p>

      <div role="tablist" aria-label="New record steps" className="tab-list">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`tabpanel-${tab.id}`}
            className={`tab-button${activeTab === tab.id ? " tab-button-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div id={`tabpanel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`} className="tab-panel">
        {activeTab === "source" && (
          <NewSourceForm onCreated={(s) => setSessionSources((prev) => [...prev, s])} />
        )}
        {activeTab === "department" && (
          <NewDepartmentForm onCreated={(d) => setSessionDepartments((prev) => [...prev, d])} />
        )}
        {activeTab === "officer" && (
          <NewOfficerForm
            sessionDepartments={sessionDepartments}
            onCreated={(o) => setSessionOfficers((prev) => [...prev, o])}
          />
        )}
        {activeTab === "incident" && (
          <NewIncidentForm
            sessionDepartments={sessionDepartments}
            sessionOfficers={sessionOfficers}
            sessionSources={sessionSources}
            onCreated={(i) => setSessionIncidents((prev) => [...prev, i])}
          />
        )}
        {activeTab === "outcome" && (
          <NewOutcomeForm
            sessionIncidents={sessionIncidents}
            sessionSources={sessionSources}
            onCreated={() => {
              /* no further chaining needed after an outcome is created */
            }}
          />
        )}
      </div>

      {(sessionSources.length > 0 ||
        sessionDepartments.length > 0 ||
        sessionOfficers.length > 0 ||
        sessionIncidents.length > 0) && (
        <div className="callout callout-info session-summary">
          <strong>Created this session:</strong> {sessionSources.length} source(s), {sessionDepartments.length}{" "}
          department(s), {sessionOfficers.length} officer(s), {sessionIncidents.length} incident(s).
        </div>
      )}
    </>
  );
}
