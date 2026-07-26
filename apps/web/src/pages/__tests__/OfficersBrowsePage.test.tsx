import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { OfficersBrowsePage } from "../OfficersBrowsePage";
import {
  listOfficersPageOneFixture,
  listOfficersLastPageFixture,
  listOfficersEmptyFixture,
} from "../../fixtures/departments";
import * as api from "../../lib/apiClient";

vi.mock("../../lib/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../../lib/apiClient")>("../../lib/apiClient");
  return {
    ...actual,
    listOfficers: vi.fn(),
  };
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/departments/:id/officers" element={<OfficersBrowsePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("OfficersBrowsePage — pagination", () => {
  beforeEach(() => {
    vi.mocked(api.listOfficers).mockReset();
  });

  it("requests page 1 by default and shows current page / total pages / total count from pageInfo", async () => {
    vi.mocked(api.listOfficers).mockResolvedValue(listOfficersPageOneFixture);
    renderAt("/departments/dept-1/officers");

    await waitFor(() =>
      expect(api.listOfficers).toHaveBeenCalledWith({ departmentId: "dept-1", page: 1, pageSize: 20 }),
    );
    expect(await screen.findByText(/Page 1 of 3 \(42 total\)/)).toBeInTheDocument();
  });

  it("disables Previous on page 1 and enables Next when more pages remain", async () => {
    vi.mocked(api.listOfficers).mockResolvedValue(listOfficersPageOneFixture);
    renderAt("/departments/dept-1/officers");

    await screen.findByText(/Page 1 of 3/);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("disables Next on the last page", async () => {
    vi.mocked(api.listOfficers).mockResolvedValue(listOfficersLastPageFixture);
    renderAt("/departments/dept-1/officers?page=3");

    await screen.findByText(/Page 3 of 3/);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
  });

  it("clicking Next requests the next page", async () => {
    vi.mocked(api.listOfficers).mockResolvedValue(listOfficersPageOneFixture);
    const user = userEvent.setup();
    renderAt("/departments/dept-1/officers");

    await screen.findByText(/Page 1 of 3/);
    vi.mocked(api.listOfficers).mockResolvedValue(listOfficersLastPageFixture);
    await user.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() =>
      expect(api.listOfficers).toHaveBeenCalledWith({ departmentId: "dept-1", page: 2, pageSize: 20 }),
    );
  });

  it("shows an explicit empty state when there are no officers, with no pagination controls", async () => {
    vi.mocked(api.listOfficers).mockResolvedValue(listOfficersEmptyFixture);
    renderAt("/departments/dept-1/officers");

    expect(await screen.findByText("No officers on file for this department yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });
});
