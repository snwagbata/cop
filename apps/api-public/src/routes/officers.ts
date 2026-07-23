import { Router } from "express";
import type {
  GetOfficerResponse,
  Incident,
  IncidentOfficerRef,
  ListOfficersResponse,
  Outcome,
  OfficerDepartmentHistoryEntry,
  OfficerDetail,
  ResolvedDisputeSummary,
  SearchOfficersResponse,
} from "@cop/shared-types";
import { STANDARD_OFFICER_PAGE_DISCLAIMER } from "@cop/shared-types";
import { pool } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";
import {
  mapDepartment,
  mapOfficerSearchCandidate,
  mapSource,
  type DepartmentRow,
  type OfficerSearchRow,
  type SourceRow,
} from "../lib/mappers.js";

export const officersRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// GET /api/public/officers/search?q=<string>&departmentId=<optional>
//
// DESIGN.md §2/§6: this endpoint intentionally returns only disambiguation-
// level fields (name, department, badge, active date range, photo) — never
// incident/outcome data — so the frontend can render the mandatory picker
// before any misconduct record is shown for any candidate.
// ---------------------------------------------------------------------------
officersRouter.get("/search", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const departmentId = typeof req.query.departmentId === "string" ? req.query.departmentId : undefined;

    if (!q) {
      throw badRequest("Query parameter 'q' is required and must be non-empty.");
    }
    if (departmentId && !UUID_RE.test(departmentId)) {
      throw badRequest("departmentId must be a valid UUID.");
    }

    const result = await pool.query<OfficerSearchRow>(
      `SELECT
         o.id, o.first_name, o.last_name, o.department_id, d.name AS department_name,
         o.badge_number, o.photo_url, o.hire_date,
         h.start_date AS history_start, h.end_date AS history_end
       FROM officers o
       JOIN departments d ON d.id = o.department_id
       LEFT JOIN LATERAL (
         SELECT start_date, end_date
         FROM officer_department_history
         WHERE officer_id = o.id AND department_id = o.department_id
         ORDER BY (end_date IS NULL) DESC, start_date DESC
         LIMIT 1
       ) h ON true
       WHERE
         (
           (o.first_name || ' ' || o.last_name) ILIKE '%' || $1 || '%'
           OR (o.first_name || ' ' || o.last_name) % $1
           OR o.badge_number ILIKE $1
         )
         AND ($2::uuid IS NULL OR o.department_id = $2)
       ORDER BY similarity(o.first_name || ' ' || o.last_name, $1) DESC, o.last_name ASC
       LIMIT 50`,
      [q, departmentId ?? null]
    );

    const body: SearchOfficersResponse = { candidates: result.rows.map(mapOfficerSearchCandidate) };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/public/officers?departmentId=<optional>&page=<default 1>&pageSize=<default 25, cap 100>
//
// Browse/filter endpoint, distinct from /search above: no query-string
// requirement, paginated, ordered alphabetically rather than by relevance.
// Reuses the same OfficerSearchCandidate mapping/row shape as /search so the
// two endpoints stay consistent about what disambiguation-level fields mean.
// ---------------------------------------------------------------------------
officersRouter.get("/", async (req, res, next) => {
  try {
    const departmentId = typeof req.query.departmentId === "string" ? req.query.departmentId : undefined;
    if (departmentId && !UUID_RE.test(departmentId)) {
      throw badRequest("departmentId must be a valid UUID.");
    }

    const pageRaw = typeof req.query.page === "string" ? Number.parseInt(req.query.page, 10) : NaN;
    const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

    const pageSizeRaw = typeof req.query.pageSize === "string" ? Number.parseInt(req.query.pageSize, 10) : NaN;
    const pageSize = Number.isInteger(pageSizeRaw) && pageSizeRaw >= 1 ? Math.min(pageSizeRaw, 100) : 25;

    const offset = (page - 1) * pageSize;

    const [rowsResult, countResult] = await Promise.all([
      pool.query<OfficerSearchRow>(
        `SELECT
           o.id, o.first_name, o.last_name, o.department_id, d.name AS department_name,
           o.badge_number, o.photo_url, o.hire_date,
           h.start_date AS history_start, h.end_date AS history_end
         FROM officers o
         JOIN departments d ON d.id = o.department_id
         LEFT JOIN LATERAL (
           SELECT start_date, end_date
           FROM officer_department_history
           WHERE officer_id = o.id AND department_id = o.department_id
           ORDER BY (end_date IS NULL) DESC, start_date DESC
           LIMIT 1
         ) h ON true
         WHERE ($1::uuid IS NULL OR o.department_id = $1)
         ORDER BY o.last_name ASC, o.first_name ASC
         LIMIT $2 OFFSET $3`,
        [departmentId ?? null, pageSize, offset]
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM officers o WHERE ($1::uuid IS NULL OR o.department_id = $1)`,
        [departmentId ?? null]
      ),
    ]);

    const body: ListOfficersResponse = {
      officers: rowsResult.rows.map(mapOfficerSearchCandidate),
      pageInfo: { page, pageSize, totalCount: Number(countResult.rows[0].count) },
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/public/officers/:id
// ---------------------------------------------------------------------------
officersRouter.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      throw badRequest("officer id must be a valid UUID.");
    }

    const officerResult = await pool.query<{
      id: string;
      first_name: string;
      last_name: string;
      known_aliases: string[];
      badge_number: string | null;
      rank: string | null;
      employment_status: OfficerDetail["employmentStatus"];
      photo_url: string | null;
      dept_id: string;
      dept_name: string;
      dept_state: string;
      dept_jurisdiction_type: string;
      dept_contact_info: string | null;
      dept_records_request_portal_url: string | null;
    }>(
      `SELECT
         o.id, o.first_name, o.last_name, o.known_aliases, o.badge_number, o.rank,
         o.employment_status, o.photo_url,
         d.id AS dept_id, d.name AS dept_name, d.state AS dept_state,
         d.jurisdiction_type AS dept_jurisdiction_type, d.contact_info AS dept_contact_info,
         d.records_request_portal_url AS dept_records_request_portal_url
       FROM officers o
       JOIN departments d ON d.id = o.department_id
       WHERE o.id = $1`,
      [id]
    );

    if (officerResult.rowCount === 0) {
      throw notFound("Officer");
    }
    const o = officerResult.rows[0];

    // -- department history ("wandering officer" timeline) ------------------
    const historyResult = await pool.query<{
      department_id: string;
      department_name: string;
      badge_number: string | null;
      start_date: string;
      end_date: string | null;
      separation_reason: string | null;
    }>(
      `SELECT h.department_id, d.name AS department_name, h.badge_number,
              h.start_date, h.end_date, h.separation_reason
       FROM officer_department_history h
       JOIN departments d ON d.id = h.department_id
       WHERE h.officer_id = $1
       ORDER BY h.start_date ASC`,
      [id]
    );
    const departmentHistory: OfficerDepartmentHistoryEntry[] = historyResult.rows.map((row) => ({
      departmentId: row.department_id,
      departmentName: row.department_name,
      badgeNumber: row.badge_number,
      startDate: row.start_date,
      endDate: row.end_date,
      separationReason: row.separation_reason,
    }));

    // -- incidents this officer is linked to ---------------------------------
    const incidentIdsResult = await pool.query<{ incident_id: string }>(
      `SELECT DISTINCT incident_id FROM incident_officers WHERE officer_id = $1`,
      [id]
    );
    const incidentIds = incidentIdsResult.rows.map((r) => r.incident_id);
    let outcomeIds: string[] = [];

    let incidents: Incident[] = [];
    if (incidentIds.length > 0) {
      const [incidentsRes, officersRes, outcomesRes, incidentCitationsRes] = await Promise.all([
        pool.query<{
          id: string;
          department_id: string;
          date: string;
          incident_type: Incident["incidentType"];
          short_description: string;
          status: Incident["status"];
        }>(
          `SELECT id, department_id, date, incident_type, short_description, status
           FROM incidents WHERE id = ANY($1::uuid[]) ORDER BY date DESC`,
          [incidentIds]
        ),
        pool.query<{
          incident_id: string;
          officer_id: string;
          first_name: string;
          last_name: string;
          involvement_role: IncidentOfficerRef["involvementRole"];
        }>(
          `SELECT io.incident_id, io.officer_id, o.first_name, o.last_name, io.involvement_role
           FROM incident_officers io
           JOIN officers o ON o.id = io.officer_id
           WHERE io.incident_id = ANY($1::uuid[])`,
          [incidentIds]
        ),
        pool.query<{
          id: string;
          incident_id: string;
          outcome_type: Outcome["outcomeType"];
          date: string | null;
          amount_cents: string | null;
          currency: string;
          details: string | null;
        }>(
          `SELECT id, incident_id, outcome_type, date, amount_cents, currency, details
           FROM outcomes WHERE incident_id = ANY($1::uuid[])`,
          [incidentIds]
        ),
        pool.query<SourceRow & { citable_id: string }>(
          `SELECT s.id, s.source_type, s.url, s.publication_date, s.retrieved_date, s.reliability_tier, c.citable_id
           FROM citations c
           JOIN sources s ON s.id = c.source_id
           WHERE c.citable_type = 'incident' AND c.citable_id = ANY($1::uuid[])`,
          [incidentIds]
        ),
      ]);

      outcomeIds = outcomesRes.rows.map((r) => r.id);
      const outcomeCitationsRes = outcomeIds.length
        ? await pool.query<SourceRow & { citable_id: string }>(
            `SELECT s.id, s.source_type, s.url, s.publication_date, s.retrieved_date, s.reliability_tier, c.citable_id
             FROM citations c
             JOIN sources s ON s.id = c.source_id
             WHERE c.citable_type = 'outcome' AND c.citable_id = ANY($1::uuid[])`,
            [outcomeIds]
          )
        : { rows: [] as (SourceRow & { citable_id: string })[] };

      const outcomeCitationsByOutcome = new Map<string, SourceRow[]>();
      for (const row of outcomeCitationsRes.rows) {
        const list = outcomeCitationsByOutcome.get(row.citable_id) ?? [];
        list.push(row);
        outcomeCitationsByOutcome.set(row.citable_id, list);
      }

      const incidentCitationsByIncident = new Map<string, SourceRow[]>();
      for (const row of incidentCitationsRes.rows) {
        const list = incidentCitationsByIncident.get(row.citable_id) ?? [];
        list.push(row);
        incidentCitationsByIncident.set(row.citable_id, list);
      }

      const outcomesByIncident = new Map<string, Outcome[]>();
      for (const row of outcomesRes.rows) {
        const outcome: Outcome = {
          id: row.id,
          incidentId: row.incident_id,
          outcomeType: row.outcome_type,
          date: row.date,
          amountCents: row.amount_cents === null ? null : Number(row.amount_cents),
          currency: row.currency,
          details: row.details,
          citations: (outcomeCitationsByOutcome.get(row.id) ?? []).map(mapSource),
        };
        const list = outcomesByIncident.get(row.incident_id) ?? [];
        list.push(outcome);
        outcomesByIncident.set(row.incident_id, list);
      }

      const officersByIncident = new Map<string, IncidentOfficerRef[]>();
      for (const row of officersRes.rows) {
        const ref: IncidentOfficerRef = {
          officerId: row.officer_id,
          firstName: row.first_name,
          lastName: row.last_name,
          involvementRole: row.involvement_role,
        };
        const list = officersByIncident.get(row.incident_id) ?? [];
        list.push(ref);
        officersByIncident.set(row.incident_id, list);
      }

      incidents = incidentsRes.rows.map((row) => ({
        id: row.id,
        departmentId: row.department_id,
        date: row.date,
        incidentType: row.incident_type,
        shortDescription: row.short_description,
        status: row.status,
        officers: officersByIncident.get(row.id) ?? [],
        outcomes: outcomesByIncident.get(row.id) ?? [],
        citations: (incidentCitationsByIncident.get(row.id) ?? []).map(mapSource),
      }));
    }

    // -- resolved disputes touching this officer or any of their incidents/
    // outcomes (DESIGN.md §12 "right-of-reply excerpt") --------------------
    const resolvedDisputesResult = await pool.query<{
      status: ResolvedDisputeSummary["status"];
      incident_id: string | null;
      outcome_id: string | null;
      officer_id: string | null;
      resolution_notes: string | null;
      resolved_at: string | null;
    }>(
      `SELECT status, incident_id, outcome_id, officer_id, resolution_notes, resolved_at
       FROM disputes
       WHERE status != 'open'
         AND resolution_notes IS NOT NULL
         AND resolved_at IS NOT NULL
         AND (
           officer_id = $1
           OR incident_id = ANY($2::uuid[])
           OR outcome_id = ANY($3::uuid[])
         )`,
      [id, incidentIds, outcomeIds]
    );
    const resolvedDisputes: ResolvedDisputeSummary[] = resolvedDisputesResult.rows.map((row) => ({
      targetType: row.officer_id ? "officer" : row.incident_id ? "incident" : "outcome",
      targetId: (row.officer_id ?? row.incident_id ?? row.outcome_id) as string,
      status: row.status,
      resolutionNotes: row.resolution_notes as string,
      resolvedAt: row.resolved_at as string,
    }));

    const departmentRow: DepartmentRow = {
      id: o.dept_id,
      name: o.dept_name,
      state: o.dept_state,
      jurisdiction_type: o.dept_jurisdiction_type,
      contact_info: o.dept_contact_info,
      records_request_portal_url: o.dept_records_request_portal_url,
    };

    const officer: OfficerDetail = {
      id: o.id,
      firstName: o.first_name,
      lastName: o.last_name,
      knownAliases: o.known_aliases,
      department: mapDepartment(departmentRow),
      badgeNumber: o.badge_number,
      rank: o.rank,
      employmentStatus: o.employment_status,
      photoUrl: o.photo_url,
      departmentHistory,
      incidents,
      resolvedDisputes,
      disclaimer: STANDARD_OFFICER_PAGE_DISCLAIMER,
    };

    const body: GetOfficerResponse = { officer };
    res.json(body);
  } catch (err) {
    next(err);
  }
});
