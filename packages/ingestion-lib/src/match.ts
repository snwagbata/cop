import type { MatchResult, Queryable } from "./types.js";

/**
 * DESIGN.md §6's fuzzy-match threshold. pg_trgm's `%` similarity operator
 * defaults to a 0.3 word-similarity threshold server-side (the same
 * default apps/api-internal/src/routes/officers.ts's GET /search implicitly
 * relies on via `% $1` in its WHERE clause) -- reused here as the same
 * "reasonably well" bar this function's docstring and INGESTION_DESIGN.md
 * §2 both refer to, so the two entry points to fuzzy officer matching in
 * this codebase agree on what "a good match" means.
 */
const AGREE_THRESHOLD = 0.3;

interface OfficerRow {
  id: string;
}

interface SimilarityRow {
  id: string;
  sim: number;
}

/**
 * DESIGN.md §6's entity-matching rules, implemented once here so no
 * individual pipeline can get the conflict rule wrong (INGESTION_DESIGN.md
 * §2: "No pipeline is ever allowed to write match_confidence: 'high' off a
 * fuzzy name match alone -- that's enforced in the shared matching helper").
 *
 * Rule order:
 *  1. postCertificationId given and matches exactly one officers row -> the
 *     primary signal. With no name given, that's enough for 'high'. With a
 *     name given, it must fuzzy-match that same officer reasonably well
 *     (reusing the same pg_trgm approach as officers.ts's GET /search) --
 *     agreement -> 'high'; disagreement (poor match, or a different officer
 *     scores better) -> the conflict rule fires unconditionally: 'low',
 *     officerId null. A postCertificationId that matches zero or multiple
 *     officers rows is *not* a usable primary signal, and deliberately does
 *     not fall back to rule 2 -- an inconsistent primary key is exactly the
 *     kind of thing that should force a human look, not a fuzzy-matched
 *     guess.
 *  2. No postCertificationId, but name + departmentName together fuzzy-match
 *     a single officers row well (scoped by department, same query shape) ->
 *     'medium'. A tie with a second candidate, or too weak a match, falls
 *     through to rule 3.
 *  3. Otherwise: 'low', officerId null.
 */
export async function matchOfficer(
  client: Queryable,
  input: { name?: string; departmentName?: string; postCertificationId?: string },
): Promise<MatchResult> {
  const name = input.name?.trim() || undefined;
  const departmentName = input.departmentName?.trim() || undefined;
  const postCertificationId = input.postCertificationId?.trim() || undefined;

  if (postCertificationId) {
    const postMatches = await client.query<OfficerRow>(
      `SELECT id FROM officers WHERE post_certification_id = $1`,
      [postCertificationId],
    );

    if (postMatches.rows.length !== 1) {
      // Zero matches (unknown POST id) or multiple matches (a data-quality
      // problem in officers itself) -- neither is a usable primary signal.
      return { officerId: null, confidence: "low" };
    }

    const officer = postMatches.rows[0];
    if (!name) {
      return { officerId: officer.id, confidence: "high" };
    }

    // Secondary signal: does `name` agree with the officer the primary
    // signal identified? Two checks mirror the two disagreement modes
    // DESIGN.md §6 names explicitly.
    const officerSimResult = await client.query<{ sim: number }>(
      `SELECT similarity(first_name || ' ' || last_name, $1) AS sim FROM officers WHERE id = $2`,
      [name, officer.id],
    );
    const officerSim = officerSimResult.rows[0]?.sim ?? 0;

    const topMatchResult = await client.query<SimilarityRow>(
      `SELECT id, similarity(first_name || ' ' || last_name, $1) AS sim
         FROM officers
        WHERE (first_name || ' ' || last_name) % $1
        ORDER BY sim DESC
        LIMIT 1`,
      [name],
    );
    const topMatch = topMatchResult.rows[0];

    const nameMatchesPoorly = officerSim < AGREE_THRESHOLD;
    const differentOfficerScoresBetter =
      topMatch !== undefined && topMatch.id !== officer.id && topMatch.sim > officerSim;

    if (nameMatchesPoorly || differentOfficerScoresBetter) {
      // The §6 conflict rule: always low/null, never resolved automatically,
      // regardless of how strong either individual signal looked alone.
      return { officerId: null, confidence: "low" };
    }

    return { officerId: officer.id, confidence: "high" };
  }

  if (name && departmentName) {
    const result = await client.query<SimilarityRow>(
      `SELECT o.id, similarity(o.first_name || ' ' || o.last_name, $1) AS sim
         FROM officers o
         JOIN departments d ON d.id = o.department_id
        WHERE (
          (o.first_name || ' ' || o.last_name) ILIKE '%' || $1 || '%'
          OR (o.first_name || ' ' || o.last_name) % $1
        )
        AND d.name ILIKE $2
        ORDER BY sim DESC
        LIMIT 2`,
      [name, departmentName],
    );
    const [best, runnerUp] = result.rows;

    const isUnambiguous = best !== undefined && (runnerUp === undefined || runnerUp.sim < best.sim);
    if (isUnambiguous && best.sim >= AGREE_THRESHOLD) {
      return { officerId: best.id, confidence: "medium" };
    }
    return { officerId: null, confidence: "low" };
  }

  return { officerId: null, confidence: "low" };
}
