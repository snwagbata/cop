import type { Department, Source } from "@cop/shared-types";

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
  url: string;
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
