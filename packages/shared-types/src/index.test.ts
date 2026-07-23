import { describe, expect, it } from "vitest";
import { STANDARD_OFFICER_PAGE_DISCLAIMER } from "./index.js";

describe("STANDARD_OFFICER_PAGE_DISCLAIMER", () => {
  it("is non-empty and explains the alleged/sustained distinction", () => {
    // This is this package's one piece of runtime logic (everything else is
    // types, checked by `tsc`, not `vitest`). It's load-bearing per
    // DESIGN.md §3 — every officer page must render it verbatim, so a
    // regression that silently empties or truncates it is worth catching.
    expect(STANDARD_OFFICER_PAGE_DISCLAIMER.length).toBeGreaterThan(100);
    expect(STANDARD_OFFICER_PAGE_DISCLAIMER).toContain("sustained");
    expect(STANDARD_OFFICER_PAGE_DISCLAIMER).toContain("not itself a finding of wrongdoing");
  });
});
