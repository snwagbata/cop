import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DisputeFormPage } from "../DisputeFormPage";
import { submitDisputeResponseFixture } from "../../fixtures/disputes";
import * as api from "../../lib/apiClient";

vi.mock("../../lib/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../../lib/apiClient")>("../../lib/apiClient");
  return {
    ...actual,
    submitDispute: vi.fn(),
  };
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DisputeFormPage />
    </MemoryRouter>,
  );
}

describe("DisputeFormPage", () => {
  beforeEach(() => {
    vi.mocked(api.submitDispute).mockReset();
  });

  it("blocks submission when requesterName and claim are missing, and never calls the API", async () => {
    const user = userEvent.setup();
    renderAt("/disputes/new");

    await user.click(screen.getByRole("button", { name: "Submit request" }));

    expect(api.submitDispute).not.toHaveBeenCalled();
    // Native required-field validation is what's currently blocking
    // submission (both fields carry the `required` attribute).
    const nameInput = screen.getByLabelText("Your name") as HTMLInputElement;
    const claimInput = screen.getByLabelText("What is inaccurate, and why?") as HTMLTextAreaElement;
    expect(nameInput.validity.valueMissing).toBe(true);
    expect(claimInput.validity.valueMissing).toBe(true);
  });

  it("submits successfully with valid fields, calling the API with the right shape and showing the returned dispute id", async () => {
    vi.mocked(api.submitDispute).mockResolvedValue(submitDisputeResponseFixture);
    const user = userEvent.setup();
    renderAt("/disputes/new?officerId=off-1");

    await user.type(screen.getByLabelText("Your name"), "Jane Doe");
    await user.type(screen.getByLabelText("What is inaccurate, and why?"), "The date is wrong.");
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    await screen.findByText(/Your correction request has been submitted/);
    expect(api.submitDispute).toHaveBeenCalledWith({
      officerId: "off-1",
      incidentId: undefined,
      outcomeId: undefined,
      requesterName: "Jane Doe",
      requesterRole: "subject",
      claim: "The date is wrong.",
      evidenceUrl: undefined,
    });
    expect(screen.getByText(submitDisputeResponseFixture.dispute.id)).toBeInTheDocument();
  });

  it("shows the submitted request's id linking to the status-check page", async () => {
    vi.mocked(api.submitDispute).mockResolvedValue(submitDisputeResponseFixture);
    const user = userEvent.setup();
    renderAt("/disputes/new?officerId=off-1");

    await user.type(screen.getByLabelText("Your name"), "Jane Doe");
    await user.type(screen.getByLabelText("What is inaccurate, and why?"), "The date is wrong.");
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    const link = await screen.findByRole("link", { name: "check its status" });
    expect(link).toHaveAttribute(
      "href",
      `/disputes/status?id=${encodeURIComponent(submitDisputeResponseFixture.dispute.id)}`,
    );
  });

  it("shows an error message and does not show the success state when the API call fails", async () => {
    vi.mocked(api.submitDispute).mockRejectedValue(new api.ApiError(400, null, "Bad request"));
    const user = userEvent.setup();
    renderAt("/disputes/new?officerId=off-1");

    await user.type(screen.getByLabelText("Your name"), "Jane Doe");
    await user.type(screen.getByLabelText("What is inaccurate, and why?"), "The date is wrong.");
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Bad request");
    expect(screen.queryByText(/has been submitted/)).not.toBeInTheDocument();
  });

  describe('the "exactly one of incident/outcome/officer id" constraint (DESIGN.md §10, enforced server-side)', () => {
    it("forwards only officerId when that's the only target param present in the URL", async () => {
      vi.mocked(api.submitDispute).mockResolvedValue(submitDisputeResponseFixture);
      const user = userEvent.setup();
      renderAt("/disputes/new?officerId=off-1");

      await user.type(screen.getByLabelText("Your name"), "Jane Doe");
      await user.type(screen.getByLabelText("What is inaccurate, and why?"), "The date is wrong.");
      await user.click(screen.getByRole("button", { name: "Submit request" }));

      await screen.findByText(/has been submitted/);
      const call = vi.mocked(api.submitDispute).mock.calls[0][0];
      expect(call.officerId).toBe("off-1");
      expect(call.incidentId).toBeUndefined();
      expect(call.outcomeId).toBeUndefined();
    });

    it(
      "BUG (documented, not fixed here): the page has no client-side guard against multiple target params — " +
        "when both officerId and incidentId are present (as IncidentCard's \"Dispute this record\" link on the " +
        "officer detail page actually generates), it forwards both, which the API rejects as a 400 " +
        '("Exactly one of incidentId, outcomeId, or officerId must be set").',
      async () => {
        vi.mocked(api.submitDispute).mockResolvedValue(submitDisputeResponseFixture);
        const user = userEvent.setup();
        renderAt("/disputes/new?incidentId=inc-1&officerId=off-1");

        await user.type(screen.getByLabelText("Your name"), "Jane Doe");
        await user.type(screen.getByLabelText("What is inaccurate, and why?"), "The date is wrong.");
        await user.click(screen.getByRole("button", { name: "Submit request" }));

        await screen.findByText(/has been submitted/);
        const call = vi.mocked(api.submitDispute).mock.calls[0][0];
        // This is the bug: both are sent, which violates the "exactly one" rule.
        expect(call.incidentId).toBe("inc-1");
        expect(call.officerId).toBe("off-1");
      },
    );
  });
});
