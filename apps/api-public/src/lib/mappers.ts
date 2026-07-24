import type { Department, OfficerSearchCandidate, Source } from "@cop/shared-types";

/** Row shape from a `SELECT d.*` (or explicitly-aliased equivalent) against `departments`. */
export interface DepartmentRow {
  id: string;
  name: string;
  state: string;
  jurisdiction_type: string;
  contact_info: string | null;
  records_request_portal_url: string | null;
}

export function mapDepartment(row: DepartmentRow): Department {
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    jurisdictionType: row.jurisdiction_type,
    contactInfo: row.contact_info,
    recordsRequestPortalUrl: row.records_request_portal_url,
  };
}

/** Row shape from a `SELECT s.*` against `sources`. */
export interface SourceRow {
  id: string;
  source_type: Source["sourceType"];
  url: string | null;
  publication_date: string | null;
  retrieved_date: string;
  reliability_tier: Source["reliabilityTier"];
}

export function mapSource(row: SourceRow): Source {
  return {
    id: row.id,
    sourceType: row.source_type,
    url: row.url,
    publicationDate: row.publication_date,
    retrievedDate: row.retrieved_date,
    reliabilityTier: row.reliability_tier,
  };
}

/**
 * Row shape shared by any query that produces disambiguation-level officer
 * fields (search, and the browse/list endpoint) — see OfficerSearchCandidate's
 * docstring in shared-types for why this stays narrow (never incident/outcome
 * data).
 */
export interface OfficerSearchRow {
  id: string;
  first_name: string;
  last_name: string;
  department_id: string;
  department_name: string;
  badge_number: string | null;
  photo_url: string | null;
  hire_date: string | null;
  history_start: string | null;
  history_end: string | null;
}

export function mapOfficerSearchCandidate(row: OfficerSearchRow): OfficerSearchCandidate {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    departmentId: row.department_id,
    departmentName: row.department_name,
    badgeNumber: row.badge_number,
    // Fall back to {start: hire_date, end: null} when there's no matching
    // officer_department_history row for the officer's current department
    // (task spec / DESIGN.md §2's disambiguation contract).
    activeDateRange: {
      start: row.history_start ?? row.hire_date ?? "",
      end: row.history_start ? row.history_end : null,
    },
    photoUrl: row.photo_url,
  };
}
