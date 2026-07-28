import type { OutcomeType } from "@cop/shared-types";

/**
 * Conservative, human-reviewed mapping from NYC CCRB's real
 * nypd_allegation_disposition strings to this schema's OutcomeType --
 * see docs/superpowers/specs/2026-07-27-nyc-ccrb-outcomes-design.md §2
 * for the full rationale and the live Socrata query this was verified
 * against (60 distinct real values as of 2026-07-27).
 *
 * Deliberately NOT an exhaustive mapping of all 60 values -- only a
 * disposition string that unambiguously implies one of the three
 * dispositions actually reachable from NYPD disciplinary data
 * (internal_discipline, termination, no_action; the other four
 * OutcomeType values -- DA_declination, lawsuit_settlement,
 * lawsuit_dismissed, criminal_charges_officer -- belong to a civil-suit/
 * prosecution track this data source doesn't cover at all) gets mapped.
 * Everything else (bare "Guilty"/plea/negotiated dispositions that don't
 * state the resulting sanction, and pending/in-process/retired/resigned/
 * deceased/no-finding/other statuses) returns null -- the raw disposition
 * string still appears in the incident's own data regardless; it's just
 * not double-encoded as structured data when confidence is low.
 */

const TERMINATION_DISPOSITIONS = new Set(["APU Closed: Terminated"]);

const INTERNAL_DISCIPLINE_DISPOSITIONS = new Set([
  "Command Discipline - A",
  "Command Discipline - B",
  "APU Command Discipline A",
  "APU Command Discipline B",
  "APU Command Discipline",
  "Instructions",
  "APU Instructions",
  "Command Level Instructions",
  "Formalized Training",
  "APU Formalized Training",
  "APU Closed: Retained, with discipline",
  "APU Retained, with discipline",
  // Judgment call, human-approved (design doc §2): the dataset separately
  // and explicitly labels "APU Closed: Terminated" as its own distinct
  // value, which implies termination is never silently folded into
  // generic "with discipline" phrasing elsewhere -- so "with discipline"
  // (no explicit "terminated") is treated as excluding termination.
  "APU Closed: Previously adjudicated, with discipline",
  "APU Previously adjudicated, with discipline",
]);

const NO_ACTION_DISPOSITIONS = new Set([
  "No Disciplinary Action-DUP",
  "No Disciplinary Action-SOL",
  "APU Not guilty",
  "Not Guilty - DCT",
  "Not Guilty - OATH",
  "APU Not guilty after trial-PC Approved",
  "APU Dismissed",
  "APU Closed: Dismissed by APU",
  "Charge Dismissed - DCT",
  "Charge Dismissed - OATH",
  "APU Closed: Charges not served",
  "APU Charges not served",
  "APU Closed: Retained, without discipline",
  "APU Closed: Previously adjudicated, without discipline",
  "APU Retained, without discipline",
  "APU Closed: SOL Expired prior to APU",
  "APU Closed: SOL Expired in APU",
]);

export function mapNypdDispositionToOutcomeType(disposition: string | null): OutcomeType | null {
  if (!disposition) return null;
  if (TERMINATION_DISPOSITIONS.has(disposition)) return "termination";
  if (INTERNAL_DISCIPLINE_DISPOSITIONS.has(disposition)) return "internal_discipline";
  if (NO_ACTION_DISPOSITIONS.has(disposition)) return "no_action";
  return null;
}
