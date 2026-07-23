import { describe, expect, it } from "vitest";
import type { IncidentStatus, OutcomeType } from "@cop/shared-types";
import { incidentStatusCategory, outcomeTypeCategory } from "../badges";

/**
 * DESIGN.md §3 requires sustained findings to be visually distinguishable
 * from dismissed/unsustained/exonerated ones, and both distinguishable from
 * the neutral alleged/pending treatment, via a *consistent* badge/color
 * mapping. This is a legal-risk mitigation, not a style preference, so every
 * enum value is asserted individually below rather than spot-checked.
 */
describe("incidentStatusCategory", () => {
  const expected: Record<IncidentStatus, ReturnType<typeof incidentStatusCategory>> = {
    sustained: "adverse",
    unsustained: "cleared",
    exonerated: "cleared",
    alleged: "neutral",
    pending: "neutral",
    disputed: "review",
  };

  for (const [status, category] of Object.entries(expected) as [IncidentStatus, string][]) {
    it(`maps "${status}" to "${category}"`, () => {
      expect(incidentStatusCategory(status)).toBe(category);
    });
  }

  it("covers every IncidentStatus value defined in @cop/shared-types", () => {
    const allStatuses: IncidentStatus[] = ["alleged", "sustained", "unsustained", "exonerated", "pending", "disputed"];
    expect(Object.keys(expected).sort()).toEqual([...allStatuses].sort());
  });
});

describe("outcomeTypeCategory", () => {
  const expected: Record<OutcomeType, ReturnType<typeof outcomeTypeCategory>> = {
    termination: "adverse",
    internal_discipline: "adverse",
    criminal_charges_officer: "adverse",
    lawsuit_settlement: "adverse",
    DA_declination: "cleared",
    lawsuit_dismissed: "cleared",
    no_action: "cleared",
  };

  for (const [type, category] of Object.entries(expected) as [OutcomeType, string][]) {
    it(`maps "${type}" to "${category}"`, () => {
      expect(outcomeTypeCategory(type)).toBe(category);
    });
  }

  it("covers every OutcomeType value defined in @cop/shared-types", () => {
    const allTypes: OutcomeType[] = [
      "internal_discipline",
      "termination",
      "DA_declination",
      "lawsuit_settlement",
      "lawsuit_dismissed",
      "criminal_charges_officer",
      "no_action",
    ];
    expect(Object.keys(expected).sort()).toEqual([...allTypes].sort());
  });

  it("never categorizes an adverse-action outcome the same as a cleared one", () => {
    // Direct anti-juxtaposition check per §3: an adverse finding and a
    // no-adverse-action outcome must never collapse into the same category.
    expect(outcomeTypeCategory("termination")).not.toBe(outcomeTypeCategory("no_action"));
  });
});
