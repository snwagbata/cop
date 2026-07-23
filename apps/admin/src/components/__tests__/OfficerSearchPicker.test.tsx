import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OfficerSearchPicker } from "../OfficerSearchPicker";
import { officerSearchFixtures } from "../../fixtures/officers";
import * as api from "../../api/client";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return {
    ...actual,
    searchOfficers: vi.fn(),
  };
});

describe("OfficerSearchPicker", () => {
  beforeEach(() => {
    vi.mocked(api.searchOfficers).mockResolvedValue({ candidates: officerSearchFixtures });
  });

  it("does not search until at least 2 characters are typed", async () => {
    const user = userEvent.setup();
    render(<OfficerSearchPicker id="picker" label="Search" onSelect={vi.fn()} />);

    await user.type(screen.getByLabelText("Search"), "A");
    await new Promise((r) => setTimeout(r, 350));
    expect(api.searchOfficers).not.toHaveBeenCalled();
  });

  it("debounces and shows matching candidates, calling onSelect when one is picked (single mode)", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<OfficerSearchPicker id="picker" label="Search" mode="single" onSelect={onSelect} />);

    await user.type(screen.getByLabelText("Search"), "Alvar");
    await waitFor(() => expect(api.searchOfficers).toHaveBeenCalledWith("Alvar"));

    const option = await screen.findByRole("option", { name: /R\. Alvarez/ });
    await user.click(option);

    expect(onSelect).toHaveBeenCalledWith(officerSearchFixtures[0]);
    expect(await screen.findByTestId("picker-selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
  });

  it("in multi mode, resets back to an empty search box after each pick instead of showing a persistent chip", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<OfficerSearchPicker id="picker" label="Search" mode="multi" onSelect={onSelect} />);

    await user.type(screen.getByLabelText("Search"), "Alvar");
    const option = await screen.findByRole("option", { name: /R\. Alvarez/ });
    await user.click(option);

    expect(onSelect).toHaveBeenCalledWith(officerSearchFixtures[0]);
    expect(screen.queryByTestId("picker-selected")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Search")).toHaveValue("");
  });

  it("shows a no-matches message when the search returns nothing", async () => {
    vi.mocked(api.searchOfficers).mockResolvedValueOnce({ candidates: [] });
    const user = userEvent.setup();
    render(<OfficerSearchPicker id="picker" label="Search" onSelect={vi.fn()} />);

    await user.type(screen.getByLabelText("Search"), "Zzzz");
    expect(await screen.findByText("No matching officers.")).toBeInTheDocument();
  });
});
