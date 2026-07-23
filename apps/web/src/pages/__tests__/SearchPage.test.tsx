import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { SearchPage } from "../SearchPage";
import { officerSearchFixtures, singleOfficerCandidateFixture } from "../../fixtures/officers";
import * as api from "../../lib/apiClient";

vi.mock("../../lib/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../../lib/apiClient")>("../../lib/apiClient");
  return {
    ...actual,
    searchOfficers: vi.fn(),
  };
});

/** Stand-in for OfficerDetailPage: proves navigation landed on the right
 * route/id without pulling in that page's own data-fetching. */
function OfficerDetailStub() {
  const { id } = useParams();
  return <div data-testid="officer-detail-stub">officer detail for {id}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<SearchPage />} />
        <Route path="/officers/:id" element={<OfficerDetailStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * DESIGN.md §2/§6's mandatory-disambiguation rule, tested as a hard
 * correctness requirement: >1 candidate must show the picker and must never
 * show incident/outcome data for any candidate before selection; exactly 1
 * candidate skips the picker entirely; 0 candidates is an explicit
 * "no results" state, never a silent empty page.
 */
describe("SearchPage — mandatory disambiguation (DESIGN.md §2/§6)", () => {
  beforeEach(() => {
    vi.mocked(api.searchOfficers).mockReset();
  });

  it("0 candidates: shows an explicit no-results state", async () => {
    vi.mocked(api.searchOfficers).mockResolvedValue({ candidates: [] });
    renderAt("/?q=Zzzzz");

    expect(await screen.findByText(/No officers matched/)).toBeInTheDocument();
    expect(screen.queryByTestId("officer-detail-stub")).not.toBeInTheDocument();
  });

  it("exactly 1 candidate: navigates straight to that officer's detail route, no picker shown", async () => {
    vi.mocked(api.searchOfficers).mockResolvedValue({ candidates: [singleOfficerCandidateFixture] });
    renderAt("/?q=Reyes");

    const stub = await screen.findByTestId("officer-detail-stub");
    expect(stub).toHaveTextContent(singleOfficerCandidateFixture.id);
    expect(screen.queryByText(/Multiple matches/)).not.toBeInTheDocument();
  });

  it(">1 candidates: renders the disambiguation picker and does NOT render any officer-detail content", async () => {
    vi.mocked(api.searchOfficers).mockResolvedValue({ candidates: officerSearchFixtures });
    renderAt("/?q=Reyes");

    expect(await screen.findByText(/Multiple matches — select the correct officer/)).toBeInTheDocument();
    // Hard requirement: no incident/outcome/officer-detail content is shown
    // for ANY candidate before one is explicitly picked.
    expect(screen.queryByTestId("officer-detail-stub")).not.toBeInTheDocument();
  });

  it("picker shows department, badge number, and active date range for every candidate before selection", async () => {
    vi.mocked(api.searchOfficers).mockResolvedValue({ candidates: officerSearchFixtures });
    renderAt("/?q=Reyes");

    await screen.findByText(/Multiple matches/);
    for (const candidate of officerSearchFixtures) {
      expect(screen.getByText(candidate.departmentName)).toBeInTheDocument();
      expect(screen.getByText(new RegExp(`Badge ${candidate.badgeNumber}`))).toBeInTheDocument();
    }
    // Distinguishing detail: two same-named candidates from different
    // departments/badge numbers must both be visible simultaneously so the
    // person can actually tell them apart.
    expect(screen.getByText("Riverdale Police Department")).toBeInTheDocument();
    expect(screen.getByText("Fairview County Sheriff's Office")).toBeInTheDocument();
  });

  it("selecting a candidate from the picker navigates to that specific officer's detail route", async () => {
    vi.mocked(api.searchOfficers).mockResolvedValue({ candidates: officerSearchFixtures });
    const user = userEvent.setup();
    renderAt("/?q=Reyes");

    await screen.findByText(/Multiple matches/);
    const buttons = screen.getAllByRole("button", { name: /James Reyes/ });
    await user.click(buttons[1]);

    const stub = await screen.findByTestId("officer-detail-stub");
    expect(stub).toHaveTextContent(officerSearchFixtures[1].id);
  });

  it("shows an error state and no results/picker when the search request fails", async () => {
    vi.mocked(api.searchOfficers).mockRejectedValue(new api.ApiError(500, null, "Something broke"));
    renderAt("/?q=Reyes");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Multiple matches/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No officers matched/)).not.toBeInTheDocument();
  });

  it("submitting the search form updates the URL query and triggers a new search", async () => {
    vi.mocked(api.searchOfficers).mockResolvedValue({ candidates: [] });
    const user = userEvent.setup();
    renderAt("/");

    await user.type(screen.getByLabelText("Officer name or badge number"), "Reyes");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(api.searchOfficers).toHaveBeenCalledWith("Reyes"));
  });
});
