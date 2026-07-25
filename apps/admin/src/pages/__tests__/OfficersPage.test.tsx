import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { OfficersPage } from "../OfficersPage";
import * as api from "../../api/client";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, searchOfficers: vi.fn() };
});

describe("OfficersPage", () => {
  it("searches and renders each result as a link to its detail page", async () => {
    vi.mocked(api.searchOfficers).mockResolvedValue({
      candidates: [
        {
          id: "00000000-0000-0000-0000-000000000012",
          firstName: "Robert",
          lastName: "Smith",
          departmentId: "00000000-0000-0000-0000-000000000001",
          departmentName: "Springfield Police Department (fictional)",
          badgeNumber: "303",
          activeDateRange: { start: "2019-06-01", end: null },
          photoUrl: null,
        },
      ],
    });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <OfficersPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByRole("textbox"), "Robert Smith");

    const link = await screen.findByRole("link", { name: /Robert Smith/ });
    expect(link).toHaveAttribute("href", "/officers/00000000-0000-0000-0000-000000000012");
  });

  it("shows a no-results message for a query that matches nothing", async () => {
    vi.mocked(api.searchOfficers).mockResolvedValue({ candidates: [] });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <OfficersPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByRole("textbox"), "Nobody Real");

    await waitFor(() => {
      expect(screen.getByText(/no matching officers/i)).toBeInTheDocument();
    });
  });
});
