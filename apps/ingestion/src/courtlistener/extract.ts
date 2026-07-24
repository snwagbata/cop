import Anthropic from "@anthropic-ai/sdk";

/**
 * LLM structured extraction step, INGESTION_DESIGN.md §3.1: "defendant
 * names on a civil rights complaint aren't reliably tagged as 'officer' vs.
 * 'department' vs. 'city', so this is the one place in this pipeline an LLM
 * pass earns its cost: one Haiku call per candidate docket." One call per
 * docket, prompted for strict JSON, parsed defensively so a malformed or
 * unexpected model response degrades to `confidence: "none"` instead of
 * throwing -- a single bad extraction should never crash a whole
 * ingestion_configs row's run.
 *
 * Model id: as of this session there's no existing convention for the
 * current Haiku model id elsewhere in this repo (checked packages/ for a
 * "claude-api" reference package and found none), so this uses the id given
 * in this task's brief directly.
 */
const MODEL = "claude-haiku-4-5-20251001";

export interface ExtractedOfficer {
  /** Full name as written in the docket's party text, or null when nothing
   * confidently identifiable was found. */
  officerName: string | null;
  /** "clear": exactly one individual officer defendant identified.
   * "ambiguous": a plausible officer name exists but isn't certain (queued
   * anyway, per run.ts, with a note flagging the ambiguity for a reviewer).
   * "none": no individual officer defendant identifiable at all -- run.ts
   * does not queue a candidate for this docket. */
  confidence: "clear" | "ambiguous" | "none";
}

const SYSTEM_PROMPT = `You extract the name of a law enforcement officer (police officer, sheriff's deputy, state trooper, etc.) named as an individual defendant in a federal civil-rights lawsuit, from raw party-list text pulled from a court docket.

The input is unstructured party-list text from a CourtListener docket search result. It typically names plaintiffs and defendants together, and defendant names are NOT reliably tagged as "officer" vs. "department" vs. "city" -- some named defendants are individual officers, others are institutional defendants (a city, county, police/sheriff's department, or other agency).

Respond with ONLY a single JSON object and nothing else -- no markdown code fence, no explanation before or after -- in exactly this shape:
{"officerName": <string or null>, "confidence": "clear" | "ambiguous" | "none"}

Rules:
- "clear": exactly one individual officer defendant is clearly identifiable by personal name (not just a badge number or title like "Unknown Officer"). Set officerName to that person's full name as written in the text.
- "ambiguous": there is at least one plausible individual officer defendant, but you cannot confidently pick a single one (multiple candidate names, or the text doesn't clearly distinguish an officer from another kind of individual defendant). Set officerName to your single best guess.
- "none": no individual officer defendant is identifiable at all -- e.g. only institutional defendants (a city, county, or department by name only), or the text is too sparse or garbled to tell. Set officerName to null.

Do not include any text outside the single JSON object.`;

/**
 * Extracts an officer name (if any) from one docket's raw party text via a
 * single Claude Haiku call. Never throws on an API failure or a malformed
 * model response -- both degrade to `{ officerName: null, confidence:
 * "none" }` so a flaky or misbehaving extraction call can't take down the
 * whole per-config-row run in run.ts.
 */
export async function extractOfficerFromPartyText(
  apiKey: string,
  partyText: string,
): Promise<ExtractedOfficer> {
  if (!partyText || !partyText.trim()) {
    return { officerName: null, confidence: "none" };
  }

  const client = new Anthropic({ apiKey });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: partyText }],
    });
  } catch {
    // Network error, rate limit, malformed-request error, etc. -- degrade
    // rather than throw. A transient Anthropic API failure on one docket
    // is not treated as a config-row-level failure; it's just one docket
    // this run couldn't extract anything from.
    return { officerName: null, confidence: "none" };
  }

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  if (!textBlock) {
    return { officerName: null, confidence: "none" };
  }

  return parseExtractionResponse(textBlock.text);
}

function parseExtractionResponse(text: string): ExtractedOfficer {
  // Tolerate the model wrapping the JSON in prose or a code fence despite
  // the system prompt's instruction not to -- take the first {...} span.
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { officerName: null, confidence: "none" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { officerName: null, confidence: "none" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { officerName: null, confidence: "none" };
  }

  const obj = parsed as Record<string, unknown>;
  const confidence = obj.confidence;
  if (confidence !== "clear" && confidence !== "ambiguous" && confidence !== "none") {
    return { officerName: null, confidence: "none" };
  }

  const rawName = typeof obj.officerName === "string" ? obj.officerName.trim() : "";

  if (confidence === "none" || rawName.length === 0) {
    // Either the model said "none", or it claimed a match but gave an
    // unusable name -- both collapse to the same safe "nothing to queue"
    // outcome rather than passing an empty/garbage name downstream.
    return { officerName: null, confidence: "none" };
  }

  return { officerName: rawName, confidence };
}
