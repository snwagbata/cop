import { Router } from "express";
import type { CreateOutcomeRequest, CreateRecordResponse, Outcome, OutcomeType } from "@cop/shared-types";
import { pool } from "../db.js";
import { ApiError } from "../errors.js";
import { asyncHandler } from "../asyncHandler.js";
import { writeRecordRevision } from "../revisions.js";
import { mapSourceRow, type SourceRow } from "../mappers.js";

export const outcomesRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_OUTCOME_TYPES: OutcomeType[] = [
  "internal_discipline",
  "termination",
  "DA_declination",
  "lawsuit_settlement",
  "lawsuit_dismissed",
  "criminal_charges_officer",
  "no_action",
];

outcomesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Partial<CreateOutcomeRequest>;
    const reviewer = req.reviewer!;

    if (typeof body.incidentId !== "string" || !UUID_RE.test(body.incidentId)) {
      throw new ApiError(400, "invalid_request", "incidentId is required and must be a valid UUID.");
    }
    if (!body.outcomeType || !VALID_OUTCOME_TYPES.includes(body.outcomeType)) {
      throw new ApiError(400, "invalid_request", `outcomeType must be one of ${VALID_OUTCOME_TYPES.join(", ")}.`);
    }
    const date = typeof body.date === "string" ? body.date : null;
    const amountCents =
      typeof body.amountCents === "number" && Number.isFinite(body.amountCents) ? Math.trunc(body.amountCents) : null;
    const currency = typeof body.currency === "string" && body.currency.trim() ? body.currency.trim() : "USD";
    const details = typeof body.details === "string" ? body.details : null;
    const sourceIds = Array.isArray(body.sourceIds) ? body.sourceIds.filter((id): id is string => typeof id === "string") : [];
    if (sourceIds.some((id) => !UUID_RE.test(id))) {
      throw new ApiError(400, "invalid_request", "Every entry in sourceIds must be a valid UUID.");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const incidentCheck = await client.query<{ id: string }>(`SELECT id FROM incidents WHERE id = $1`, [body.incidentId]);
      if (!incidentCheck.rows[0]) {
        throw new ApiError(400, "invalid_request", `No incident found with id ${body.incidentId}.`);
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

      const insertResult = await client.query<{
        id: string;
        incident_id: string;
        outcome_type: OutcomeType;
        date: string | null;
        amount_cents: string | null;
        currency: string;
        details: string | null;
      }>(
        `INSERT INTO outcomes (incident_id, outcome_type, date, amount_cents, currency, details)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, incident_id, outcome_type, date, amount_cents, currency, details`,
        [body.incidentId, body.outcomeType, date, amountCents, currency, details],
      );
      const row = insertResult.rows[0];

      for (const sourceId of sourceIds) {
        await client.query(
          `INSERT INTO citations (source_id, citable_type, citable_id) VALUES ($1, 'outcome', $2)`,
          [sourceId, row.id],
        );
      }

      const diff = {
        incidentId: body.incidentId,
        outcomeType: body.outcomeType,
        date,
        amountCents,
        currency,
        details,
        sourceIds,
      };
      const revisionId = await writeRecordRevision(client, {
        recordType: "outcome",
        recordId: row.id,
        changeType: "create",
        diff,
        changedBy: reviewer.id,
      });

      await client.query("COMMIT");

      const record: Outcome = {
        id: row.id,
        incidentId: row.incident_id,
        outcomeType: row.outcome_type,
        date: row.date,
        amountCents: row.amount_cents === null ? null : Number(row.amount_cents),
        currency: row.currency,
        details: row.details,
        citations: sourceRows.map(mapSourceRow),
      };

      const response: CreateRecordResponse<Outcome> = { record, revisionId };
      res.status(201).json(response);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);
