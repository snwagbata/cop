import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { DashboardPage } from "../DashboardPage";
import { digestFixture } from "../../fixtures/digest";
import * as api from "../../api/client";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return {
    ...actual,
    fetchReviewDigest: vi.fn(),
  };
});

vi.mock("../../context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("../../context/AuthContext")>("../../context/AuthContext");
  return {
    ...actual,
    useAuth: () => ({
      reviewer: { id: "rev-1", name: "Admin Reviewer", email: "reviewer@example.org", role: "admin", active: true },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
    }),
  };
});

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.mocked(api.fetchReviewDigest).mockResolvedValue({ digest: digestFixture });
  });

  it("loads and renders the weekly digest numbers", async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(api.fetchReviewDigest).toHaveBeenCalled());
    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/9 auto-matched with high confidence/)).toBeInTheDocument();
  });

  it("shows an error banner when the digest fails to load", async () => {
    vi.mocked(api.fetchReviewDigest).mockRejectedValueOnce(new Error("Could not reach the internal API"));
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not reach the internal API/);
  });
});
