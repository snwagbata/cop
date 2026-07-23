import { Router } from "express";
import type { CreateDepartmentRequest, Department } from "@cop/shared-types";
import { pool } from "../db.js";
import { ApiError } from "../errors.js";
import { asyncHandler } from "../asyncHandler.js";
import { mapDepartmentRow, type DepartmentRow } from "../mappers.js";

export const departmentsRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/internal/departments
//
// NOTE on the response shape: the task contract calls for
// CreateRecordResponse<Department> (record + revisionId), mirroring officers/
// incidents/outcomes/sources. Unlike those four, 'department' is not one of
// record_revisions.record_type's four allowed values (officer / incident /
// outcome / source -- DB CHECK constraint in migration 0011, matching
// DESIGN.md §4's record_revisions definition verbatim; no new migrations are
// in scope for this build-out). There is nowhere valid to write a revision
// row for a department create, for the same underlying reason POST
// /citations skips the wrapper entirely (citable_type has no 'department'
// counterpart either). We follow that precedent: insert the department, skip
// the record_revisions write, and return `{ record }` without a fabricated
// revisionId rather than claim an audit-trail entry that doesn't exist.
// ---------------------------------------------------------------------------
departmentsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Partial<CreateDepartmentRequest>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const state = typeof body.state === "string" ? body.state.trim() : "";
    const jurisdictionType = typeof body.jurisdictionType === "string" ? body.jurisdictionType.trim() : "";

    if (!name || !state || !jurisdictionType) {
      throw new ApiError(400, "invalid_request", "name, state, and jurisdictionType are required.");
    }
    const contactInfo = typeof body.contactInfo === "string" && body.contactInfo.trim() ? body.contactInfo : null;
    const recordsRequestPortalUrl =
      typeof body.recordsRequestPortalUrl === "string" && body.recordsRequestPortalUrl.trim()
        ? body.recordsRequestPortalUrl
        : null;

    const result = await pool.query<DepartmentRow>(
      `INSERT INTO departments (name, state, jurisdiction_type, contact_info, records_request_portal_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, state, jurisdiction_type, contact_info, records_request_portal_url`,
      [name, state, jurisdictionType, contactInfo, recordsRequestPortalUrl],
    );

    const record: Department = mapDepartmentRow(result.rows[0]);
    res.status(201).json({ record });
  }),
);
