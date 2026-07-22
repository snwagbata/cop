import type { IncidentStatus, OutcomeType } from "@cop/shared-types";

/**
 * Consistent, site-wide visual-category system for findings/outcomes.
 * DESIGN.md §3 requires that sustained findings be visually distinct from
 * dismissed/unsustained/exonerated ones via a *consistent* badge/color
 * system (never text alone), and that alleged/pending get a third, neutral
 * treatment rather than being lumped in with either. This module is the one
 * place that mapping lives, so every page applies it identically.
 */
export type BadgeCategory = "adverse" | "cleared" | "neutral" | "review";

const INCIDENT_STATUS_CATEGORY: Record<IncidentStatus, BadgeCategory> = {
  sustained: "adverse",
  unsustained: "cleared",
  exonerated: "cleared",
  alleged: "neutral",
  pending: "neutral",
  disputed: "review",
};

// Outcome types don't carry a status field directly, but for the same
// juxtaposition-risk reasons (§3) they need the same consistent treatment:
// outcomes that reflect an adverse action/finding against the officer read
// the same as "sustained"; outcomes reflecting no adverse action/finding
// read the same as "dismissed/unsustained/exonerated".
const OUTCOME_TYPE_CATEGORY: Record<OutcomeType, BadgeCategory> = {
  termination: "adverse",
  internal_discipline: "adverse",
  criminal_charges_officer: "adverse",
  lawsuit_settlement: "adverse",
  DA_declination: "cleared",
  lawsuit_dismissed: "cleared",
  no_action: "cleared",
};

export function incidentStatusCategory(status: IncidentStatus): BadgeCategory {
  return INCIDENT_STATUS_CATEGORY[status] ?? "neutral";
}

export function outcomeTypeCategory(type: OutcomeType): BadgeCategory {
  return OUTCOME_TYPE_CATEGORY[type] ?? "neutral";
}
