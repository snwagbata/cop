import { Router } from "express";
import type {
  CreateIncidentRequest,
  CreateRecordResponse,
  Incident,
  IncidentOfficerRef,
  IncidentStatus,
  IncidentType,
  InvolvementRole,
} from "@cop/shared-types";
import { pool } from "../db.js";
import { ApiError } from "../errors.js";
import { asyncHandler } from "../asyncHandler.js";
import { writeRecordRevision } from "../revisions.js";
import { mapSourceRow, type SourceRow } from "../mappers.js";

export const incidentsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_INCIDENT_TYPES: IncidentType[] = ["use_of_force", "false_report", "unlawful_arrest", "other"];
const VALID_STATUSES: IncidentStatus[] = ["alleged", "sustained", "unsustained", "exonerated", "pending", "disputed"];

incidentsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Partial<CreateIncidentRequest>;
    const reviewer = req.reviewer!;

    if (typeof body.departmentId !== "string" || !UUID_RE.test(body.departmentId)) {
      throw new ApiError(400, "invalid_request", "departmentId is required and must be a valid UUID.");
    }
    const date = typeof body.date === "string" ? body.date : "";
    if (!date) {
      throw new ApiError(400, "invalid_request", "date is required.");
    }
    if (!body.incidentType || !VALID_INCIDENT_TYPES.includes(body.incidentType)) {
      throw new ApiError(400, "invalid_request", `incidentType must be one of ${VALID_INCIDENT_TYPES.join(", ")}.`);
    }
    const shortDescription = typeof body.shortDescription === "string" ? body.shortDescription.trim() : "";
    if (!shortDescription) {
      throw new ApiError(400, "invalid_request", "shortDescription is required.");
    }
    const status: IncidentStatus = body.status ?? "alleged";
    if (!VALID_STATUSES.includes(status)) {
      throw new ApiError(400, "invalid_request", `status must be one of ${VALID_STATUSES.join(", ")}.`);
    }
    const officerIds = Array.isArray(body.officerIds) ? body.officerIds.filter((id): id is string => typeof id === "string") : [];
    if (officerIds.length === 0) {
      throw new ApiError(400, "invalid_request", "officerIds is required and must contain at least one officer id.");
    }
    if (officerIds.some((id) => !UUID_RE.test(id))) {
      throw new ApiError(400, "invalid_request", "Every entry in officerIds must be a valid UUID.");
    }
    const sourceIds = Array.isArray(body.sourceIds) ? body.sourceIds.filter((id): id is string => typeof id === "string") : [];
    if (sourceIds.some((id) => !UUID_RE.test(id))) {
      throw new ApiError(400, "invalid_request", "Every entry in sourceIds must be a valid UUID.");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const deptCheck = await client.query<{ id: string }>(`SELECT id FROM departments WHERE id = $1`, [body.departmentId]);
      if (!deptCheck.rows[0]) {
        throw new ApiError(400, "invalid_request", `No department found with id ${body.departmentId}.`);
      }

      const officerRows = await client.query<{ id: string; first_name: string; last_name: string }>(
        `SELECT id, first_name, last_name FROM officers WHERE id = ANY($1::uuid[])`,
        [officerIds],
      );
      const officerById = new Map(officerRows.rows.map((r) => [r.id, r]));
      const missingOfficerIds = officerIds.filter((id) => !officerById.has(id));
      if (missingOfficerIds.length > 0) {
        throw new ApiError(400, "invalid_request", `No officer found with id(s) ${missingOfficerIds.join(", ")}.`);
      }

      let sourceRows: SourceRow[] = [];
      if (sourceIds.length > 0) {
        const sourcesResult = await client.query<SourceRow>(
          `SELECT id, source_type, url, publication_date, retrieved_date, reliability_tier
             FROM sources WHERE id = ANY($1::uuid[])`,
          [sourceIds],
        );
        sourceRows = sourcesResult.rows;
        const foundIds = new Set(sourceRows.map((r) => r.id));
        const missingSourceIds = sourceIds.filter((id) => !foundIds.has(id));
        if (missingSourceIds.length > 0) {
          throw new ApiError(
            400,
            "invalid_request",
            `No source found with id(s) ${missingSourceIds.join(", ")}. Create it first via POST /api/internal/sources.`,
          );
        }
      }

      const incidentResult = await client.query<{
        id: string;
        department_id: string;
        date: string;
        incident_type: IncidentType;
        short_description: string;
        status: IncidentStatus;
      }>(
        `INSERT INTO incidents (department_id, date, incident_type, short_description, status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, department_id, date, incident_type, short_description, status`,
        [body.departmentId, date, body.incidentType, shortDescription, status],
      );
      const incidentRow = incidentResult.rows[0];

      const officers: IncidentOfficerRef[] = [];
      for (let i = 0; i < officerIds.length; i++) {
        const officerId = officerIds[i];
        const involvementRole: InvolvementRole = i === 0 ? "primary" : "other";
        await client.query(
          `INSERT INTO incident_officers (incident_id, officer_id, involvement_role) VALUES ($1, $2, $3)`,
          [incidentRow.id, officerId, involvementRole],
        );
        const o = officerById.get(officerId)!;
        officers.push({ officerId, firstName: o.first_name, lastName: o.last_name, involvementRole });
      }

      for (const sourceId of sourceIds) {
        await client.query(
          `INSERT INTO citations (source_id, citable_type, citable_id) VALUES ($1, 'incident', $2)`,
          [sourceId, incidentRow.id],
        );
      }

      const diff = {
        departmentId: body.departmentId,
        date,
        incidentType: body.incidentType,
        shortDescription,
        status,
        officerIds,
        sourceIds,
      };
      const revisionId = await writeRecordRevision(client, {
        recordType: "incident",
        recordId: incidentRow.id,
        changeType: "create",
        diff,
        changedBy: reviewer.id,
      });

      await client.query("COMMIT");

      const record: Incident = {
        id: incidentRow.id,
        departmentId: incidentRow.department_id,
        date: incidentRow.date,
        incidentType: incidentRow.incident_type,
        shortDescription: incidentRow.short_description,
        status: incidentRow.status,
        officers,
        outcomes: [],
        citations: sourceRows.map(mapSourceRow),
      };

      const response: CreateRecordResponse<Incident> = { record, revisionId };
      res.status(201).json(response);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);
