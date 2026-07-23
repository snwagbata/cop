import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DisputeStatusPage } from "../DisputeStatusPage";
import { disputeStatusOpenFixture, disputeStatusResolvedFixture } from "../../fixtures/disputes";
import * as api from "../../lib/apiClient";

vi.mock("../../lib/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../../lib/apiClient")>("../../lib/apiClient");
  return {
    ...actual,
    getDisputeStatus: vi.fn(),
  };
});

describe("DisputeStatusPage", () => {
  beforeEach(() => {
    vi.mocked(api.getDisputeStatus).mockReset();
  });

  it("submitting an id calls GET /disputes/:id and renders the narrow status response", async () => {
    vi.mocked(api.getDisputeStatus).mockResolvedValue(disputeStatusResolvedFixture);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DisputeStatusPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Request id"), disputeStatusResolvedFixture.id);
    await user.click(screen.getByRole("button", { name: "Check status" }));

    expect(api.getDisputeStatus).toHaveBeenCalledWith(disputeStatusResolvedFixture.id);
    expect(await screen.findByText(disputeStatusResolvedFixture.id)).toBeInTheDocument();
    expect(screen.getByText("Resolved — Record Corrected")).toBeInTheDocument();
    // Both submittedAt and resolvedAt render (not "Not yet resolved").
    expect(screen.queryByText("Not yet resolved")).not.toBeInTheDocument();
  });

  it("renders 'Not yet resolved' when resolvedAt is null (open dispute)", async () => {
    vi.mocked(api.getDisputeStatus).mockResolvedValue(disputeStatusOpenFixture);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DisputeStatusPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Request id"), disputeStatusOpenFixture.id);
    await user.click(screen.getByRole("button", { name: "Check status" }));

    expect(await screen.findByText("Not yet resolved")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("shows a clear not-found message on a 404, and does not render a result", async () => {
    vi.mocked(api.getDisputeStatus).mockRejectedValue(new api.ApiError(404, null, "not found"));
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DisputeStatusPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Request id"), "does-not-exist");
    await user.click(screen.getByRole("button", { name: "Check status" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/No correction request found/);
    expect(screen.queryByText("Request id")).toBeInTheDocument(); // form still shown
    expect(screen.queryByRole("definition")).not.toBeInTheDocument();
  });
});
