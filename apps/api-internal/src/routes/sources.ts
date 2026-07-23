import { Router } from "express";
import type { CreateRecordResponse, CreateSourceRequest, ReliabilityTier, Source, SourceType } from "@cop/shared-types";
import { pool } from "../db.js";
import { ApiError } from "../errors.js";
import { asyncHandler } from "../asyncHandler.js";
import { writeRecordRevision } from "../revisions.js";
import { mapSourceRow, type SourceRow } from "../mappers.js";

export const sourcesRouter = Router();

const VALID_SOURCE_TYPES: SourceType[] = [
  "court_doc",
  "news_article",
  "public_records_response",
  "official_dataset",
  "decertification_registry",
];

const VALID_RELIABILITY_TIERS: ReliabilityTier[] = [
  "tier1_primary_legal_doc",
  "tier2_official_dataset",
  "tier3_established_news",
  "tier4_submitted_unverified",
];

sourcesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Partial<CreateSourceRequest>;
    const reviewer = req.reviewer!;

    if (!body.sourceType || !VALID_SOURCE_TYPES.includes(body.sourceType)) {
      throw new ApiError(400, "invalid_request", `sourceType must be one of ${VALID_SOURCE_TYPES.join(", ")}.`);
    }
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) {
      throw new ApiError(400, "invalid_request", "url is required.");
    }
    if (!body.reliabilityTier || !VALID_RELIABILITY_TIERS.includes(body.reliabilityTier)) {
      throw new ApiError(
        400,
        "invalid_request",
        `reliabilityTier must be one of ${VALID_RELIABILITY_TIERS.join(", ")}.`,
      );
    }
    const publicationDate = typeof body.publicationDate === "string" ? body.publicationDate : null;
    // Defaults to today, per CreateSourceRequest's contract.
    const retrievedDate = typeof body.retrievedDate === "string" ? body.retrievedDate : null;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const insertResult = await client.query<SourceRow>(
        `INSERT INTO sources (source_type, url, publication_date, retrieved_date, reliability_tier)
         VALUES ($1, $2, $3, COALESCE($4, current_date), $5)
         RETURNING id, source_type, url, publication_date, retrieved_date, reliability_tier`,
        [body.sourceType, url, publicationDate, retrievedDate, body.reliabilityTier],
      );
      const source = mapSourceRow(insertResult.rows[0]);

      const revisionId = await writeRecordRevision(client, {
        recordType: "source",
        recordId: source.id,
        changeType: "create",
        diff: { sourceType: source.sourceType, url: source.url, publicationDate: source.publicationDate, retrievedDate: source.retrievedDate, reliabilityTier: source.reliabilityTier },
        changedBy: reviewer.id,
      });

      await client.query("COMMIT");

      const response: CreateRecordResponse<Source> = { record: source, revisionId };
      res.status(201).json(response);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);
