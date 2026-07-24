import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DisputesPage } from "../DisputesPage";
import { disputeFixtures } from "../../fixtures/disputes";
import * as api from "../../api/client";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return {
    ...actual,
    fetchDisputes: vi.fn(),
    resolveDispute: vi.fn(),
  };
});

describe("DisputesPage", () => {
  beforeEach(() => {
    vi.mocked(api.fetchDisputes).mockResolvedValue({ disputes: disputeFixtures });
    vi.mocked(api.resolveDispute).mockResolvedValue(undefined);
  });

  it("loads and renders all open disputes from the fixture data", async () => {
    render(
      <MemoryRouter>
        <DisputesPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(api.fetchDisputes).toHaveBeenCalledWith("open"));
    for (const dispute of disputeFixtures) {
      expect(await screen.findByTestId(`dispute-${dispute.id}`)).toBeInTheDocument();
    }
  });

  it("resolves a dispute and removes it from the open list", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DisputesPage />
      </MemoryRouter>,
    );
    const card = await screen.findByTestId("dispute-dp-2");

    await user.click(within(card).getByRole("button", { name: "Resolve" }));
    await user.selectOptions(within(card).getByLabelText("Resolution"), "resolved_no_change");
    await user.type(within(card).getByLabelText("Resolution notes"), "Settlement amount confirmed correct.");
    await user.click(within(card).getByRole("button", { name: "Submit resolution" }));

    await waitFor(() => expect(screen.queryByTestId("dispute-dp-2")).not.toBeInTheDocument());
    expect(api.resolveDispute).toHaveBeenCalledWith("dp-2", {
      status: "resolved_no_change",
      resolutionNotes: "Settlement amount confirmed correct.",
    });
  });

  it("shows an empty state when there are no open disputes", async () => {
    vi.mocked(api.fetchDisputes).mockResolvedValueOnce({ disputes: [] });
    render(
      <MemoryRouter>
        <DisputesPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/No open disputes/)).toBeInTheDocument();
  });
});
