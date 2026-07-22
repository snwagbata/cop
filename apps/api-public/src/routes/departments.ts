import { Router } from "express";
import type { GetDepartmentStatsResponse, ListDepartmentsResponse } from "@cop/shared-types";
import { pool } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";
import { mapDepartment, type DepartmentRow } from "../lib/mappers.js";

export const departmentsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/public/departments
departmentsRouter.get("/", async (_req, res, next) => {
  try {
    const result = await pool.query<DepartmentRow>(
      `SELECT id, name, state, jurisdiction_type, contact_info, records_request_portal_url
       FROM departments
       ORDER BY name ASC`
    );
    const body: ListDepartmentsResponse = { departments: result.rows.map(mapDepartment) };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// GET /api/public/departments/:id/stats
departmentsRouter.get("/:id/stats", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      throw badRequest("departmentId must be a valid UUID.");
    }

    const result = await pool.query<
      DepartmentRow & {
        stats_department_id: string | null;
        total_settlement_amount_cents: string | null;
        sustained_complaint_count: string | null;
        total_incident_count: string | null;
        wandering_officer_hire_count: string | null;
        last_computed_at: string | null;
      }
    >(
      `SELECT
         d.id, d.name, d.state, d.jurisdiction_type, d.contact_info, d.records_request_portal_url,
         ds.department_id AS stats_department_id,
         ds.total_settlement_amount_cents,
         ds.sustained_complaint_count,
         ds.total_incident_count,
         ds.wandering_officer_hire_count,
         ds.last_computed_at
       FROM departments d
       LEFT JOIN department_stats ds ON ds.department_id = d.id
       WHERE d.id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      throw notFound("Department");
    }

    const row = result.rows[0];
    const body: GetDepartmentStatsResponse = {
      department: mapDepartment(row),
      stats: {
        departmentId: row.id,
        // department_stats is populated for every department via COALESCE(...,
        // 0) in migration 0013 — a null here means the view hasn't been
        // refreshed since this department was added, not a legitimate zero
        // distinct from an actual zero. We fall back to 0 either way since
        // there's no meaningful different value to show the public.
        totalSettlementAmountCents: row.total_settlement_amount_cents
          ? Number(row.total_settlement_amount_cents)
          : 0,
        sustainedComplaintCount: row.sustained_complaint_count
          ? Number(row.sustained_complaint_count)
          : 0,
        totalIncidentCount: row.total_incident_count ? Number(row.total_incident_count) : 0,
        wanderingOfficerHireCount: row.wandering_officer_hire_count
          ? Number(row.wandering_officer_hire_count)
          : 0,
        lastComputedAt: row.last_computed_at ?? new Date().toISOString(),
      },
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});
