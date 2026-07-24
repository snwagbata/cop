import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CitationList } from "../CitationList";
import { sourceFixtures } from "../../fixtures/sources";

describe("CitationList", () => {
  it("renders 'No source citation on file' when given an empty array", () => {
    render(<CitationList citations={[]} />);
    expect(screen.getByText("No source citation on file for this record.")).toBeInTheDocument();
  });

  it("renders a 'view source' link for a citation with a url", () => {
    render(<CitationList citations={[sourceFixtures[0]]} />);
    const link = screen.getByRole("link", { name: "view source" });
    expect(link).toHaveAttribute("href", sourceFixtures[0].url);
  });

  it(
    "renders tier/type text without a hyperlink when a citation has a null url " +
      "(a tip_submission source promoted from a text-only anonymous tip, DESIGN.md §12 — " +
      "migration 0018 made sources.url nullable for exactly this case)",
    () => {
      const textOnlyTipSource = {
        ...sourceFixtures[0],
        id: "src-tip-1",
        sourceType: "tip_submission" as const,
        url: null,
      };
      render(<CitationList citations={[textOnlyTipSource]} />);

      expect(screen.queryByRole("link", { name: "view source" })).not.toBeInTheDocument();
      expect(screen.getByText(/no external link/i)).toBeInTheDocument();
      expect(screen.getByText(/Public Tip Submission/i)).toBeInTheDocument();
    },
  );

  it("does not throw and does not render a broken link when copying citation text for a null-url source", () => {
    const textOnlyTipSource = {
      ...sourceFixtures[0],
      id: "src-tip-2",
      sourceType: "tip_submission" as const,
      url: null,
    };
    render(<CitationList citations={[textOnlyTipSource]} />);
    expect(screen.getByRole("button", { name: /Copy citation/ })).toBeInTheDocument();
  });
});
