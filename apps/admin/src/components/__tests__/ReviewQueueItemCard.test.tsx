import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewQueueItemCard } from "../ReviewQueueItemCard";
import { reviewQueueFixtures } from "../../fixtures/reviewQueue";

describe("ReviewQueueItemCard", () => {
  it("renders an officer_candidate proposal with its source and confidence", () => {
    const item = reviewQueueFixtures[0]; // officer_candidate, high confidence, tier2 source
    render(<ReviewQueueItemCard item={item} onApprove={vi.fn()} onReject={vi.fn()} />);

    expect(screen.getByText(/Jordan Michaels/)).toBeInTheDocument();
    expect(screen.getByText(/Riverdale Police Department/)).toBeInTheDocument();
    expect(screen.getByText("4417")).toBeInTheDocument();
    expect(screen.getByText("CA-POST-88213")).toBeInTheDocument();
    expect(screen.getByText(/match: high/)).toBeInTheDocument();
    expect(screen.getByText(/Tier 2/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /post\.ca\.gov/ })).toHaveAttribute(
      "href",
      item.source!.url,
    );
  });

  it("renders an incident_candidate proposal that is already matched to an officer, with no officerId input required", () => {
    const item = reviewQueueFixtures[1]; // incident_candidate with officerId set
    render(<ReviewQueueItemCard item={item} onApprove={vi.fn()} onReject={vi.fn()} />);

    expect(screen.getByText(/DA's office declined to prosecute/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Officer ID/)).not.toBeInTheDocument();
  });

  it("renders 'No source attached' when source is null", () => {
    const item = reviewQueueFixtures.find((i) => i.source === null)!;
    render(<ReviewQueueItemCard item={item} onApprove={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText("No source attached.")).toBeInTheDocument();
  });

  it("requires an officer ID before allowing approve on an unmatched incident_candidate", async () => {
    const user = userEvent.setup();
    const item = reviewQueueFixtures[2]; // incident_candidate, officerName only, no officerId
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(<ReviewQueueItemCard item={item} onApprove={onApprove} onReject={vi.fn()} />);

    expect(screen.getByLabelText(/Officer ID/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter the officer's ID before approving/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Officer ID/), "off-999");
    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(onApprove).toHaveBeenCalledWith(item.id, { officerId: "off-999" });
  });

  it("calls onApprove with no edits for an officer_candidate", async () => {
    const user = userEvent.setup();
    const item = reviewQueueFixtures[0];
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(<ReviewQueueItemCard item={item} onApprove={onApprove} onReject={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).toHaveBeenCalledWith(item.id, undefined);
  });

  it("requires a reason before submitting a rejection, then calls onReject", async () => {
    const user = userEvent.setup();
    const item = reviewQueueFixtures[0];
    const onReject = vi.fn().mockResolvedValue(undefined);
    render(<ReviewQueueItemCard item={item} onApprove={vi.fn()} onReject={onReject} />);

    await user.click(screen.getByRole("button", { name: "Reject" }));
    const confirmBtn = screen.getByRole("button", { name: "Confirm reject" });
    await user.click(confirmBtn);
    expect(onReject).not.toHaveBeenCalled();
    expect(screen.getByText(/A short reason is required/)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Reason for rejection"), "Duplicate of an existing record");
    await user.click(screen.getByRole("button", { name: "Confirm reject" }));

    expect(onReject).toHaveBeenCalledWith(item.id, "Duplicate of an existing record");
  });

  it("surfaces an API error message inline when approve rejects", async () => {
    const user = userEvent.setup();
    const item = reviewQueueFixtures[0];
    const onApprove = vi.fn().mockRejectedValue(new Error("approval failed: department not found"));
    render(<ReviewQueueItemCard item={item} onApprove={onApprove} onReject={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText(/approval failed: department not found/)).toBeInTheDocument();
  });
});
