import type { Department, Source } from "@cop/shared-types";

/**
 * Row-mapping helpers for the internal API's manual-entry routes. Deliberately
 * separate from apps/api-public's src/lib/mappers.ts -- the two are different
 * services on purpose (DESIGN.md §8/§9), so a little duplication here is
 * intended, not an oversight.
 */

export interface DepartmentRow {
  id: string;
  name: string;
  state: string;
  jurisdiction_type: string;
  contact_info: string | null;
  records_request_portal_url: string | null;
}

export function mapDepartmentRow(row: DepartmentRow): Department {
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    jurisdictionType: row.jurisdiction_type,
    contactInfo: row.contact_info,
    recordsRequestPortalUrl: row.records_request_portal_url,
  };
}

export interface SourceRow {
  id: string;
  source_type: Source["sourceType"];
  url: string;
  publication_date: string | null;
  retrieved_date: string;
  reliability_tier: Source["reliabilityTier"];
}

export function mapSourceRow(row: SourceRow): Source {
  return {
    id: row.id,
    sourceType: row.source_type,
    url: row.url,
    publicationDate: row.publication_date,
    retrievedDate: row.retrieved_date,
    reliabilityTier: row.reliability_tier,
  };
}
