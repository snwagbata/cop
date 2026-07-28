import { describe, expect, it } from "vitest";
import { mapNypdDispositionToOutcomeType } from "../../src/nyc-ccrb/disposition.js";

describe("mapNypdDispositionToOutcomeType", () => {
  it("returns null for null input", () => {
    expect(mapNypdDispositionToOutcomeType(null)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(mapNypdDispositionToOutcomeType("")).toBeNull();
  });

  it.each([
    ["APU Closed: Terminated", "termination"],
    ["Command Discipline - A", "internal_discipline"],
    ["Command Discipline - B", "internal_discipline"],
    ["APU Command Discipline A", "internal_discipline"],
    ["APU Command Discipline B", "internal_discipline"],
    ["APU Command Discipline", "internal_discipline"],
    ["Instructions", "internal_discipline"],
    ["APU Instructions", "internal_discipline"],
    ["Command Level Instructions", "internal_discipline"],
    ["Formalized Training", "internal_discipline"],
    ["APU Formalized Training", "internal_discipline"],
    ["APU Closed: Retained, with discipline", "internal_discipline"],
    ["APU Retained, with discipline", "internal_discipline"],
    ["APU Closed: Previously adjudicated, with discipline", "internal_discipline"],
    ["APU Previously adjudicated, with discipline", "internal_discipline"],
    ["No Disciplinary Action-DUP", "no_action"],
    ["No Disciplinary Action-SOL", "no_action"],
    ["APU Not guilty", "no_action"],
    ["Not Guilty - DCT", "no_action"],
    ["Not Guilty - OATH", "no_action"],
    ["APU Not guilty after trial-PC Approved", "no_action"],
    ["APU Dismissed", "no_action"],
    ["APU Closed: Dismissed by APU", "no_action"],
    ["Charge Dismissed - DCT", "no_action"],
    ["Charge Dismissed - OATH", "no_action"],
    ["APU Closed: Charges not served", "no_action"],
    ["APU Charges not served", "no_action"],
    ["APU Closed: Retained, without discipline", "no_action"],
    ["APU Closed: Previously adjudicated, without discipline", "no_action"],
    ["APU Retained, without discipline", "no_action"],
    ["APU Closed: SOL Expired prior to APU", "no_action"],
    ["APU Closed: SOL Expired in APU", "no_action"],
  ])("maps %s to %s", (disposition, expected) => {
    expect(mapNypdDispositionToOutcomeType(disposition)).toBe(expected);
  });

  it.each([
    "APU Guilty",
    "Charges and Specifications - Guilty",
    "Plead Guilty - DCT",
    "Plead Guilty - OATH",
    "Guilty - OATH",
    "Negttn-Guilty",
    "Negttn-Nolo contendre",
    "APU Nolo contendere",
    "APU Resolved by plea",
    "APU Closed: Previously adjudicated, discipline not reported",
    "APU - Decision Pending",
    "Filed",
    "APU Closed: MOS Retired",
    "Resigned",
    "Retired",
    "No Finding",
    "APU Closed: Other",
    "DAO case",
    "APU Closed: MOS Deceased",
    "Abated by Death",
    "Some completely unrecognized future disposition string",
  ])("leaves %s unmapped (returns null)", (disposition) => {
    expect(mapNypdDispositionToOutcomeType(disposition)).toBeNull();
  });
});
