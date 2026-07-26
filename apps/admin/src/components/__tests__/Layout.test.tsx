import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { Layout } from "../Layout";

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

describe("Layout", () => {
  it("renders the primary nav, reviewer info, and children", () => {
    render(
      <MemoryRouter>
        <Layout>
          <p>page content</p>
        </Layout>
      </MemoryRouter>,
    );
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.getByText(/Admin Reviewer/)).toBeInTheDocument();
  });

  it("has a mobile nav toggle that expands and collapses the primary nav", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Layout>
          <p>page content</p>
        </Layout>
      </MemoryRouter>,
    );

    const toggle = screen.getByRole("button", { name: "Toggle navigation" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
