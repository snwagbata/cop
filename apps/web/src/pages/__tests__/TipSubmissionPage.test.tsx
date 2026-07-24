import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { CreatePublicTipResponse } from "@cop/shared-types";
import { TipSubmissionPage } from "../TipSubmissionPage";
import * as api from "../../lib/apiClient";

vi.mock("../../lib/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../../lib/apiClient")>("../../lib/apiClient");
  return {
    ...actual,
    submitTip: vi.fn(),
  };
});

const submitTipResponseFixture: CreatePublicTipResponse = { success: true };

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/tips/new"]}>
      <TipSubmissionPage />
    </MemoryRouter>,
  );
}

describe("TipSubmissionPage", () => {
  beforeEach(() => {
    vi.mocked(api.submitTip).mockReset();
  });

  it("blocks submission when description is missing, and never calls the API", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Submit tip" }));

    expect(api.submitTip).not.toHaveBeenCalled();
    const descriptionInput = screen.getByLabelText("What happened?") as HTMLTextAreaElement;
    expect(descriptionInput.validity.valueMissing).toBe(true);
  });

  it("never renders any name/role/identity field — this form is genuinely anonymous", () => {
    renderPage();
    expect(screen.queryByLabelText(/your name/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/your role/i)).not.toBeInTheDocument();
  });

  it("submits successfully with only the required field, calling the API with defaults for the rest", async () => {
    vi.mocked(api.submitTip).mockResolvedValue(submitTipResponseFixture);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("What happened?"), "An officer struck a handcuffed person.");
    await user.click(screen.getByRole("button", { name: "Submit tip" }));

    await screen.findByText(/your tip has been submitted for review/i);
    expect(api.submitTip).toHaveBeenCalledWith({
      description: "An officer struck a handcuffed person.",
      officerNameAsReported: undefined,
      departmentNameAsReported: undefined,
      incidentType: "other",
      incidentDateAsReported: undefined,
      externalUrl: undefined,
    });
  });

  it("submits with every optional field filled in", async () => {
    vi.mocked(api.submitTip).mockResolvedValue(submitTipResponseFixture);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("What happened?"), "Bodycam footage shows excessive force.");
    await user.type(screen.getByLabelText(/Officer name, if known/i), "Officer Rourke");
    await user.type(screen.getByLabelText(/Department, if known/i), "Riverdale PD");
    await user.selectOptions(screen.getByLabelText("Type of incident"), "use_of_force");
    await user.type(screen.getByLabelText(/When did this happen/i), "sometime last spring");
    await user.type(screen.getByLabelText(/Link to footage or a document/i), "https://example.com/clip");
    await user.click(screen.getByRole("button", { name: "Submit tip" }));

    await screen.findByText(/your tip has been submitted for review/i);
    expect(api.submitTip).toHaveBeenCalledWith({
      description: "Bodycam footage shows excessive force.",
      officerNameAsReported: "Officer Rourke",
      departmentNameAsReported: "Riverdale PD",
      incidentType: "use_of_force",
      incidentDateAsReported: "sometime last spring",
      externalUrl: "https://example.com/clip",
    });
  });

  it("the success state does not show any id or status-check link — no follow-up is possible by design", async () => {
    vi.mocked(api.submitTip).mockResolvedValue(submitTipResponseFixture);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("What happened?"), "Something happened.");
    await user.click(screen.getByRole("button", { name: "Submit tip" }));

    await screen.findByText(/there's no way to check its status or follow up with you directly/i);
    expect(screen.queryByRole("link", { name: /status/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^id:/i)).not.toBeInTheDocument();
  });

  it("shows an error message and does not show the success state when the API call fails", async () => {
    vi.mocked(api.submitTip).mockRejectedValue(new api.ApiError(400, null, "Bad request"));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("What happened?"), "Something happened.");
    await user.click(screen.getByRole("button", { name: "Submit tip" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Bad request");
    expect(screen.queryByText(/has been submitted/)).not.toBeInTheDocument();
  });

  // INGESTION_DESIGN.md §3.9 — the "I witnessed this" / "I found a document
  // about this" toggle is UI framing only. These tests cover: default mode
  // matches the pre-toggle form (regression), switching modes swaps the
  // visible copy, and — most importantly — the toggle never changes the
  // shape of what gets sent to submitTip.
  describe("witness / document mode toggle", () => {
    it("defaults to witness framing, matching the form's original copy", () => {
      renderPage();

      expect(screen.getByRole("button", { name: "I witnessed this" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "I found a document about this" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(screen.getByLabelText("What happened?")).toBeInTheDocument();
      expect(screen.getByLabelText(/Link to footage or a document \(optional\)/)).toBeInTheDocument();
      expect(screen.getByText(/something you witnessed/i)).toBeInTheDocument();
    });

    it("switching to document mode updates the description label, url label, and subtitle copy", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole("button", { name: "I found a document about this" }));

      expect(screen.getByRole("button", { name: "I found a document about this" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: "I witnessed this" })).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByLabelText("What does the document show, briefly?")).toBeInTheDocument();
      expect(screen.queryByLabelText("What happened?")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Link to the court filing, article, or document")).toBeInTheDocument();
      expect(screen.getByText(/court filing, a news article, a FOIA response/i)).toBeInTheDocument();
    });

    it("switching back to witness mode restores the original copy", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole("button", { name: "I found a document about this" }));
      await user.click(screen.getByRole("button", { name: "I witnessed this" }));

      expect(screen.getByLabelText("What happened?")).toBeInTheDocument();
      expect(screen.getByLabelText(/Link to footage or a document \(optional\)/)).toBeInTheDocument();
    });

    it("does not require the URL field even in document mode — externalUrl stays optional server-side", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole("button", { name: "I found a document about this" }));

      const urlInput = screen.getByLabelText("Link to the court filing, article, or document") as HTMLInputElement;
      expect(urlInput.required).toBe(false);
    });

    it("submits an identical payload shape in document mode as in witness mode — the toggle is presentation-only", async () => {
      vi.mocked(api.submitTip).mockResolvedValue(submitTipResponseFixture);
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole("button", { name: "I found a document about this" }));
      await user.type(
        screen.getByLabelText("What does the document show, briefly?"),
        "A FOIA response shows a sustained finding.",
      );
      await user.type(
        screen.getByLabelText("Link to the court filing, article, or document"),
        "https://example.com/foia-response.pdf",
      );
      await user.click(screen.getByRole("button", { name: "Submit tip" }));

      await screen.findByText(/your tip has been submitted for review/i);
      expect(api.submitTip).toHaveBeenCalledWith({
        description: "A FOIA response shows a sustained finding.",
        officerNameAsReported: undefined,
        departmentNameAsReported: undefined,
        incidentType: "other",
        incidentDateAsReported: undefined,
        externalUrl: "https://example.com/foia-response.pdf",
      });

      // Same keys/shape as the witness-mode payload asserted above — just
      // different values. Confirms the toggle never changes the data model.
      const [payload] = vi.mocked(api.submitTip).mock.calls[0];
      expect(Object.keys(payload).sort()).toEqual(
        [
          "description",
          "officerNameAsReported",
          "departmentNameAsReported",
          "incidentType",
          "incidentDateAsReported",
          "externalUrl",
        ].sort(),
      );
    });
  });
});
