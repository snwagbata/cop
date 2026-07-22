import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DisputeCard } from "../DisputeCard";
import { disputeFixtures } from "../../fixtures/disputes";

describe("DisputeCard", () => {
  it("renders requester, role, target, claim, and evidence link", () => {
    const dispute = disputeFixtures[0];
    render(<DisputeCard dispute={dispute} onResolve={vi.fn()} />);

    expect(screen.getByText(/Officer Jordan Michaels/)).toBeInTheDocument();
    expect(screen.getByText("officer")).toBeInTheDocument();
    expect(screen.getByText(/Incident inc-101/)).toBeInTheDocument();
    expect(screen.getByText(/incident date listed is incorrect/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ia-finding-corrected/ })).toHaveAttribute(
      "href",
      dispute.evidenceUrl,
    );
  });

  it("does not render an evidence link when evidenceUrl is null", () => {
    const dispute = disputeFixtures.find((d) => d.evidenceUrl === null)!;
    render(<DisputeCard dispute={dispute} onResolve={vi.fn()} />);
    expect(screen.queryByText(/Evidence:/)).not.toBeInTheDocument();
  });

  it("requires resolution notes before submitting, then calls onResolve with the chosen status", async () => {
    const user = userEvent.setup();
    const dispute = disputeFixtures[0];
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(<DisputeCard dispute={dispute} onResolve={onResolve} />);

    await user.click(screen.getByRole("button", { name: "Resolve" }));
    await user.click(screen.getByRole("button", { name: "Submit resolution" }));
    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.getByText(/Resolution notes are required/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Resolution"), "resolved_corrected");
    await user.type(screen.getByLabelText("Resolution notes"), "Corrected the date per submitted IA finding.");
    await user.click(screen.getByRole("button", { name: "Submit resolution" }));

    expect(onResolve).toHaveBeenCalledWith(
      dispute.id,
      "resolved_corrected",
      "Corrected the date per submitted IA finding.",
    );
  });
});
