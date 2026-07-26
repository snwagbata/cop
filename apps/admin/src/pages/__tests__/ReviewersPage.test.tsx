import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { ReviewersPage } from "../ReviewersPage";
import { reviewerFixtures } from "../../fixtures/reviewers";
import * as api from "../../api/client";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return {
    ...actual,
    fetchReviewers: vi.fn(),
    createReviewer: vi.fn(),
    updateReviewer: vi.fn(),
  };
});

describe("ReviewersPage", () => {
  beforeEach(() => {
    vi.mocked(api.fetchReviewers).mockResolvedValue({ reviewers: reviewerFixtures });
  });

  it("loads and lists all reviewers with their role and active status", async () => {
    render(
      <MemoryRouter>
        <ReviewersPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(api.fetchReviewers).toHaveBeenCalled());

    expect(await screen.findByText("Admin Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Sam Reviewer")).toBeInTheDocument();
    expect(screen.getByText("deactivated")).toBeInTheDocument();
  });

  it("requires name/email/password before adding a reviewer, then calls createReviewer", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createReviewer).mockResolvedValue({
      id: "rev-4",
      name: "New Person",
      email: "new@example.org",
      role: "reviewer",
      active: true,
    });
    render(
      <MemoryRouter>
        <ReviewersPage />
      </MemoryRouter>,
    );
    await screen.findByText("Admin Reviewer");

    await user.click(screen.getByRole("button", { name: "Add reviewer" }));
    expect(screen.getByText(/all required/)).toBeInTheDocument();
    expect(api.createReviewer).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Name"), "New Person");
    await user.type(screen.getByLabelText("Email"), "new@example.org");
    await user.type(screen.getByLabelText("Temporary password"), "supersecret1");
    await user.click(screen.getByRole("button", { name: "Add reviewer" }));

    await waitFor(() =>
      expect(api.createReviewer).toHaveBeenCalledWith({
        name: "New Person",
        email: "new@example.org",
        role: "reviewer",
        password: "supersecret1",
      }),
    );
  });

  it("toggles a reviewer's active status", async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateReviewer).mockResolvedValue({ ...reviewerFixtures[1], active: false });
    render(
      <MemoryRouter>
        <ReviewersPage />
      </MemoryRouter>,
    );
    await screen.findByText("Sam Reviewer");

    const row = screen.getByText("Sam Reviewer").closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Deactivate" }));

    await waitFor(() => expect(api.updateReviewer).toHaveBeenCalledWith("rev-2", { active: false }));
  });
});
