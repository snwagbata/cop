import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { OfficerDetailPage } from "../OfficerDetailPage";
import * as api from "../../api/client";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return {
    ...actual,
    fetchOfficerDetail: vi.fn(),
    updateOfficer: vi.fn(),
  };
});

const DETAIL = {
  id: "00000000-0000-0000-0000-000000000012",
  firstName: "Robert",
  lastName: "Smith",
  knownAliases: [],
  departmentId: "00000000-0000-0000-0000-000000000001",
  departmentName: "Springfield Police Department (fictional)",
  badgeNumber: "303",
  rank: null,
  hireDate: "2019-06-01",
  employmentStatus: "active" as const,
  postCertificationId: "CA-POST-000222",
  photoUrl: null,
  photoConfirmed: false,
  createdAt: "2020-01-01T00:00:00.000Z",
  departmentHistory: [
    {
      departmentId: "00000000-0000-0000-0000-000000000002",
      departmentName: "Shelbyville Police Department (fictional)",
      badgeNumber: "55",
      startDate: "2015-01-01",
      endDate: "2019-05-31",
      separationReason: "terminated after sustained internal affairs investigation",
    },
  ],
  incidentCount: 2,
  outcomeCount: 1,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/officers/00000000-0000-0000-0000-000000000012"]}>
      <Routes>
        <Route path="/officers/:id" element={<OfficerDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("OfficerDetailPage", () => {
  beforeEach(() => {
    vi.mocked(api.fetchOfficerDetail).mockResolvedValue(DETAIL);
  });

  it("loads and renders the officer's detail, including department history", async () => {
    renderPage();

    expect(await screen.findByText(/Robert Smith/)).toBeInTheDocument();
    expect(screen.getByText(/CA-POST-000222/)).toBeInTheDocument();
    expect(screen.getByText(/Shelbyville Police Department \(fictional\)/)).toBeInTheDocument();
    expect(screen.getByText(/terminated after sustained internal affairs investigation/)).toBeInTheDocument();
  });

  it("toggles into edit mode and submits only the changed field", async () => {
    vi.mocked(api.updateOfficer).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(/Robert Smith/);
    await user.click(screen.getByRole("button", { name: /edit/i }));

    const rankInput = screen.getByLabelText(/rank/i);
    await user.clear(rankInput);
    await user.type(rankInput, "Lieutenant");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(api.updateOfficer).toHaveBeenCalledWith(
        "00000000-0000-0000-0000-000000000012",
        expect.objectContaining({ rank: "Lieutenant" }),
      );
    });
  });

  it("shows departmentId as read-only with a note, not an editable field", async () => {
    renderPage();
    await screen.findByText(/Robert Smith/);
    await userEvent.setup().click(screen.getByRole("button", { name: /edit/i }));

    expect(screen.queryByLabelText(/^department$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/transfer officer/i)).toBeInTheDocument();
  });
});
