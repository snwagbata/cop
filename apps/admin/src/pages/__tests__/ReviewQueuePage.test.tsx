import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewQueuePage } from "../ReviewQueuePage";
import { reviewQueueFixtures } from "../../fixtures/reviewQueue";
import * as api from "../../api/client";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return {
    ...actual,
    fetchReviewQueue: vi.fn(),
    approveReviewQueueItem: vi.fn(),
    rejectReviewQueueItem: vi.fn(),
  };
});

describe("ReviewQueuePage", () => {
  beforeEach(() => {
    vi.mocked(api.fetchReviewQueue).mockResolvedValue({ items: reviewQueueFixtures });
    vi.mocked(api.approveReviewQueueItem).mockResolvedValue(undefined);
    vi.mocked(api.rejectReviewQueueItem).mockResolvedValue(undefined);
  });

  it("loads and renders all pending items from the fixture data", async () => {
    render(<ReviewQueuePage />);
    await waitFor(() => expect(api.fetchReviewQueue).toHaveBeenCalledWith("pending"));
    for (const item of reviewQueueFixtures) {
      const testId = `review-item-${item.id}`;
      expect(await screen.findByTestId(testId)).toBeInTheDocument();
    }
  });

  it("removes an item from the list after a successful approve", async () => {
    const user = userEvent.setup();
    render(<ReviewQueuePage />);
    await screen.findByTestId("review-item-rq-1");

    const card = screen.getByTestId("review-item-rq-1");
    const approveBtn = within(card).getByRole("button", { name: "Approve" });
    await user.click(approveBtn);

    await waitFor(() => expect(screen.queryByTestId("review-item-rq-1")).not.toBeInTheDocument());
    expect(api.approveReviewQueueItem).toHaveBeenCalledWith("rq-1", { edits: undefined });
  });

  it("shows an empty state when there are no pending items", async () => {
    vi.mocked(api.fetchReviewQueue).mockResolvedValueOnce({ items: [] });
    render(<ReviewQueuePage />);
    expect(await screen.findByText(/Nothing pending/)).toBeInTheDocument();
  });

  it("shows a top-level error banner when the initial fetch fails", async () => {
    vi.mocked(api.fetchReviewQueue).mockRejectedValueOnce(new Error("Could not reach the internal API"));
    render(<ReviewQueuePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not reach the internal API/);
  });
});
