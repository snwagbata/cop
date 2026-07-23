import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { STANDARD_OFFICER_PAGE_DISCLAIMER } from "@cop/shared-types";
import { DisclaimerBlock } from "../DisclaimerBlock";

describe("DisclaimerBlock", () => {
  it("renders the exact STANDARD_OFFICER_PAGE_DISCLAIMER string verbatim, not a paraphrase", () => {
    render(<DisclaimerBlock text={STANDARD_OFFICER_PAGE_DISCLAIMER} />);
    expect(screen.getByRole("note")).toHaveTextContent(STANDARD_OFFICER_PAGE_DISCLAIMER);
  });

  it("does not silently omit the disclaimer text it is given", () => {
    render(<DisclaimerBlock text="custom disclaimer copy for this test" />);
    expect(screen.getByText(/custom disclaimer copy for this test/)).toBeInTheDocument();
  });
});
