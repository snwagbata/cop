import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { digestFixture } from "../fixtures/digest";
import * as api from "../api/client";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    fetchReviewDigest: vi.fn(),
    fetchReviewQueue: vi.fn(),
    fetchDisputes: vi.fn(),
    fetchRecordRevisions: vi.fn(),
    fetchReviewers: vi.fn(),
  };
});

const adminReviewer = {
  id: "rev-1",
  name: "Admin Reviewer",
  email: "admin@example.org",
  role: "admin" as const,
  active: true,
};
const nonAdminReviewer = {
  id: "rev-2",
  name: "Sam Reviewer",
  email: "sam@example.org",
  role: "reviewer" as const,
  active: true,
};

// Overrides only useAuth — AuthProvider is left as the real implementation
// (harmless, since consumers read from the mocked hook, not real context),
// which is the same approach DashboardPage.test.tsx uses.
let mockAuthState: { reviewer: typeof adminReviewer | typeof nonAdminReviewer | null; isAuthenticated: boolean };

vi.mock("../context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("../context/AuthContext")>("../context/AuthContext");
  return {
    ...actual,
    useAuth: () => ({
      reviewer: mockAuthState.reviewer,
      isAuthenticated: mockAuthState.isAuthenticated,
      login: vi.fn(),
      logout: vi.fn(),
    }),
  };
});

describe("App routing/guards", () => {
  beforeEach(() => {
    vi.mocked(api.fetchReviewDigest).mockResolvedValue({ digest: digestFixture });
    vi.mocked(api.fetchReviewQueue).mockResolvedValue({ items: [] });
    vi.mocked(api.fetchDisputes).mockResolvedValue({ disputes: [] });
    vi.mocked(api.fetchRecordRevisions).mockResolvedValue({
      revisions: [],
      pageInfo: { page: 1, pageSize: 25, totalCount: 0 },
    });
    vi.mocked(api.fetchReviewers).mockResolvedValue({ reviewers: [] });
  });

  it("redirects an unauthenticated visitor from a protected route to /login", async () => {
    mockAuthState = { reviewer: null, isAuthenticated: false };
    render(
      <MemoryRouter initialEntries={["/review-queue"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Select all/)).not.toBeInTheDocument();
    expect(api.fetchReviewQueue).not.toHaveBeenCalled();
  });

  it("redirects an unauthenticated visitor away from the admin-only /reviewers route to /login", async () => {
    mockAuthState = { reviewer: null, isAuthenticated: false };
    render(
      <MemoryRouter initialEntries={["/reviewers"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(api.fetchReviewers).not.toHaveBeenCalled();
  });

  it("does not render the Reviewers nav link for an authenticated non-admin reviewer", async () => {
    mockAuthState = { reviewer: nonAdminReviewer, isAuthenticated: true };
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => expect(api.fetchReviewDigest).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Reviewers" })).not.toBeInTheDocument();
  });

  it("blocks a non-admin reviewer from reaching /reviewers by direct navigation, not just hiding the nav link", async () => {
    mockAuthState = { reviewer: nonAdminReviewer, isAuthenticated: true };
    render(
      <MemoryRouter initialEntries={["/reviewers"]}>
        <App />
      </MemoryRouter>,
    );

    // RequireAdmin redirects to "/" (Dashboard) rather than rendering ReviewersPage.
    await waitFor(() => expect(api.fetchReviewDigest).toHaveBeenCalled());
    expect(api.fetchReviewers).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Add reviewer" })).not.toBeInTheDocument();
  });

  it("allows an admin reviewer to reach /reviewers by direct navigation", async () => {
    mockAuthState = { reviewer: adminReviewer, isAuthenticated: true };
    render(
      <MemoryRouter initialEntries={["/reviewers"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => expect(api.fetchReviewers).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "Add reviewer" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reviewers" })).toBeInTheDocument();
  });

  it("redirects an authenticated reviewer away from an unknown route to the dashboard", async () => {
    mockAuthState = { reviewer: adminReviewer, isAuthenticated: true };
    render(
      <MemoryRouter initialEntries={["/some-unknown-path"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => expect(api.fetchReviewDigest).toHaveBeenCalled());
  });
});
