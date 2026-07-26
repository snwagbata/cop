import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { OfficerDetailPage } from "../OfficerDetailPage";
import { officerDetailFixture, officerDetailEmptyHistoryFixture } from "../../fixtures/officers";
import { STANDARD_OFFICER_PAGE_DISCLAIMER } from "@cop/shared-types";
import * as api from "../../lib/apiClient";

vi.mock("../../lib/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../../lib/apiClient")>("../../lib/apiClient");
  return {
    ...actual,
    getOfficer: vi.fn(),
  };
});

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/officers/${id}`]}>
      <Routes>
        <Route path="/officers/:id" element={<OfficerDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("OfficerDetailPage", () => {
  beforeEach(() => {
    vi.mocked(api.getOfficer).mockReset();
  });

  it("renders every incident, its outcomes, and its citations from the fixture", async () => {
    vi.mocked(api.getOfficer).mockResolvedValue({ officer: officerDetailFixture });
    renderAt("off-1");

    expect(await screen.findByText("Use-of-force complaint during a traffic stop.")).toBeInTheDocument();
    for (const incident of officerDetailFixture.incidents) {
      expect(screen.getByText(incident.shortDescription)).toBeInTheDocument();
      for (const outcome of incident.outcomes) {
        if (outcome.details) {
          expect(screen.getByText(outcome.details)).toBeInTheDocument();
        }
      }
      for (const citation of incident.citations) {
        // Citations render as "view source" links pointing at the source url.
        const links = screen.getAllByRole("link", { name: "view source" });
        expect(links.some((l) => l.getAttribute("href") === citation.url)).toBe(true);
      }
    }
  });

  it("renders the disclaimer verbatim near the top of the page", async () => {
    vi.mocked(api.getOfficer).mockResolvedValue({ officer: officerDetailFixture });
    renderAt("off-1");

    expect(await screen.findByRole("note")).toHaveTextContent(STANDARD_OFFICER_PAGE_DISCLAIMER);
  });

  it("renders every departmentHistory entry (the wandering-officer timeline)", async () => {
    vi.mocked(api.getOfficer).mockResolvedValue({ officer: officerDetailFixture });
    renderAt("off-1");

    const heading = await screen.findByText("Department history");
    const historyList = heading.closest("section")!.querySelector(".history-list") as HTMLElement;
    for (const entry of officerDetailFixture.departmentHistory) {
      expect(within(historyList).getByText(entry.departmentName)).toBeInTheDocument();
    }
    expect(within(historyList).getByText(/resigned during investigation/)).toBeInTheDocument();
  });

  it("shows an explicit empty state when departmentHistory is []", async () => {
    vi.mocked(api.getOfficer).mockResolvedValue({ officer: officerDetailEmptyHistoryFixture });
    renderAt("off-3");

    expect(await screen.findByText("No department history on file.")).toBeInTheDocument();
  });

  it("renders resolvedDisputes entries inline, matched to their targetType/targetId", async () => {
    vi.mocked(api.getOfficer).mockResolvedValue({ officer: officerDetailFixture });
    renderAt("off-1");

    // The fixture's one resolvedDispute targets incident "inc-2" (the
    // false-report allegation) — its resolution note must appear inside
    // THAT incident's card specifically, not any other incident's card.
    const dispute = officerDetailFixture.resolvedDisputes[0];
    const targetCard = (await screen.findByText("Allegation of a falsified incident report.")).closest(
      ".incident-card",
    ) as HTMLElement;
    expect(within(targetCard).getByText(dispute.resolutionNotes)).toBeInTheDocument();

    const otherCard = screen.getByText("Use-of-force complaint during a traffic stop.").closest(
      ".incident-card",
    ) as HTMLElement;
    expect(within(otherCard).queryByText(dispute.resolutionNotes)).not.toBeInTheDocument();
  });

  it("renders no resolved-dispute notes when resolvedDisputes is []", async () => {
    vi.mocked(api.getOfficer).mockResolvedValue({ officer: officerDetailEmptyHistoryFixture });
    renderAt("off-3");

    await screen.findByText("No department history on file.");
    expect(document.querySelector(".resolved-dispute")).not.toBeInTheDocument();
  });

  it("shows a clear message on a 404 from the API", async () => {
    vi.mocked(api.getOfficer).mockRejectedValue(new api.ApiError(404, null, "not found"));
    renderAt("off-missing");

    expect(await screen.findByRole("alert")).toHaveTextContent(/No officer record found/);
  });
});
