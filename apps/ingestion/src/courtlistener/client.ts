/**
 * CourtListener/RECAP REST API v4 HTTP client -- INGESTION_DESIGN.md §3.1's
 * federal half.
 *
 * ============================================================================
 * ⚠️  UNVERIFIED API CONTRACT -- READ THIS BEFORE TRUSTING THIS FILE WITH A
 *     REAL COURTLISTENER_API_KEY AND A REAL BUDGET.
 * ============================================================================
 *
 * Every request/response shape in this file is a best-effort guess, NOT
 * verified against CourtListener's real documentation or a real API call.
 * The environment this file was written in has outbound HTTPS restricted to
 * an organizational allowlist that does not include courtlistener.com --
 * both a direct `curl` and a web-fetch tool got a 403 from the network
 * policy layer itself (not from CourtListener), so there was no way to
 * confirm any of the following against the real API:
 *
 *   - the exact search endpoint path and query parameter names (assumed:
 *     `GET /api/rest/v4/search/?q=<query>&type=r[&court=<id>]` -- `type=r`
 *     scopes to RECAP/PACER dockets per CourtListener's documented search
 *     types; the "nature of suit" filter this pipeline would eventually
 *     want for narrowing to §1983 civil-rights filings is NOT implemented
 *     here at all, because its exact param name is the single most likely
 *     thing in this file to be wrong -- see TODO below)
 *   - the auth header shape (assumed: `Authorization: Token <api_key>`,
 *     CourtListener's documented convention as of this pipeline's design,
 *     but unverified)
 *   - the response envelope (assumed: standard Django REST Framework
 *     pagination -- `{count, next, previous, results: [...]}`)
 *   - each result's field names (assumed a mix of `docket_id`/`id`,
 *     `caseName`/`case_name`, `court`/`court_id`, `dateFiled`/`date_filed`,
 *     `absolute_url`, and -- least confidently -- a free-text party field
 *     tried in order `party`, `party_and_attorney_info`, `parties`; the
 *     search API is documented as not cleanly separating "officer
 *     defendant" from "city/department defendant" in this text, which is
 *     exactly why extract.ts's LLM step exists)
 *
 * Fixing any of the above (once someone with real access to
 * https://www.courtlistener.com/api/ checks it) should be a small, contained
 * change to THIS FILE ONLY -- run.ts and extract.ts depend only on the
 * normalized `CourtListenerDocket` shape below, never on a raw CourtListener
 * field name. That isolation is deliberate: it's the whole reason this HTTP
 * logic lives in its own module instead of being inlined into run.ts.
 *
 * TODO(needs live verification): add a `natureOfSuit` / equivalent filter
 * once the real param name is confirmed, so `keyword` config rows can be
 * scoped to §1983 filings server-side instead of relying entirely on the
 * free-text `q` search.
 * ============================================================================
 */

const BASE_URL = "https://www.courtlistener.com/api/rest/v4/";

/**
 * Hard cap on how many pages of a single search this client will follow.
 * CourtListener's search endpoint is assumed to paginate (standard DRF
 * `next`/`previous` cursor-or-page links); this cap exists purely so a
 * misbehaving or unexpectedly large result set can't turn one config row's
 * run into an unbounded fetch loop. INGESTION_DESIGN.md §3.1 itself notes
 * volume here is naturally low ("single digits to low dozens" per
 * department per week), so this cap is not expected to bind in practice.
 */
const MAX_PAGES = 5;

/** Normalized shape this client produces -- the only thing the rest of the
 * pipeline (run.ts, extract.ts) depends on. See the file-level warning
 * above: everything upstream of this normalization is unverified. */
export interface CourtListenerDocket {
  /** CourtListener's own docket id, as a string -- this pipeline's dedup key
   * (INGESTION_DESIGN.md §3.1: "Dedup key: CourtListener's docket id"). */
  docketId: string;
  caseName: string;
  court: string;
  dateFiled: string | null;
  docketUrl: string;
  /** Raw party-list text for extract.ts's LLM extraction step to work on --
   * assumed free text, not reliably separating officer/department/city
   * defendants (see file-level comment). */
  partyText: string;
}

/** Loosely-typed raw shape of one CourtListener search result -- every
 * field is optional and read defensively in normalizeResult, since this
 * is exactly the part of the contract that's unverified. */
interface RawSearchResult {
  docket_id?: number | string;
  id?: number | string;
  caseName?: string;
  case_name?: string;
  court?: string;
  court_id?: string;
  dateFiled?: string;
  date_filed?: string;
  absolute_url?: string;
  party?: string;
  party_and_attorney_info?: string;
  parties?: string;
}

interface RawSearchResponse {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results?: RawSearchResult[];
}

/**
 * Searches CourtListener/RECAP for candidate federal §1983 dockets matching
 * a watched department's keyword (and optional court id), following
 * pagination up to MAX_PAGES. Throws on a network error, a non-2xx
 * response, or an unparseable response body -- callers (run.ts) are
 * expected to catch and record the failure per config row rather than let
 * one bad request crash the whole pipeline run.
 */
export async function searchCourtListener(
  apiKey: string,
  query: { keyword: string; court?: string },
): Promise<CourtListenerDocket[]> {
  const dockets: CourtListenerDocket[] = [];
  const seenDocketIds = new Set<string>();

  const params = new URLSearchParams({ q: query.keyword, type: "r" });
  if (query.court) {
    params.set("court", query.court);
  }
  let url: string | null = `${BASE_URL}search/?${params.toString()}`;

  for (let page = 0; url !== null && page < MAX_PAGES; page++) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Token ${apiKey}` },
      });
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(`CourtListener search request failed (network error) for ${url}: ${cause}`);
    }

    if (!response.ok) {
      throw new Error(`CourtListener search request failed: ${response.status} ${response.statusText} (url=${url})`);
    }

    let body: RawSearchResponse;
    try {
      body = (await response.json()) as RawSearchResponse;
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(`CourtListener search response was not valid JSON (url=${url}): ${cause}`);
    }

    for (const raw of body.results ?? []) {
      const normalized = normalizeResult(raw);
      if (normalized !== null && !seenDocketIds.has(normalized.docketId)) {
        seenDocketIds.add(normalized.docketId);
        dockets.push(normalized);
      }
    }

    url = body.next ?? null;
  }

  return dockets;
}

function normalizeResult(raw: RawSearchResult): CourtListenerDocket | null {
  const docketId = raw.docket_id ?? raw.id;
  if (docketId === undefined || docketId === null || docketId === "") {
    // No stable id -- can't dedupe or cite this result. Skip it rather than
    // throw and lose every other result on the page over one malformed
    // entry (defensive parsing, per this file's "unverified contract"
    // status -- a field-name mismatch should degrade gracefully, not crash
    // the run).
    return null;
  }

  const docketUrl = raw.absolute_url ? new URL(raw.absolute_url, "https://www.courtlistener.com").toString() : "";

  return {
    docketId: String(docketId),
    caseName: raw.caseName ?? raw.case_name ?? "Unknown case name",
    court: raw.court ?? raw.court_id ?? "unknown",
    dateFiled: raw.dateFiled ?? raw.date_filed ?? null,
    docketUrl,
    partyText: raw.party ?? raw.party_and_attorney_info ?? raw.parties ?? "",
  };
}
