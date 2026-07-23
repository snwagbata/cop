import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CreateIncidentRequest } from "@cop/shared-types";
import { NewIncidentForm } from "../NewIncidentForm";
import { officerSearchFixtures } from "../../../fixtures/officers";
import * as api from "../../../api/client";

vi.mock("../../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/client")>("../../../api/client");
  return {
    ...actual,
    createIncident: vi.fn(),
    searchOfficers: vi.fn(),
  };
});

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Department ID"), "dept-1");
  await user.type(screen.getByLabelText("Date"), "2025-06-01");
  await user.type(screen.getByLabelText("Short description"), "Use of force during a traffic stop.");
}

describe("NewIncidentForm", () => {
  beforeEach(() => {
    vi.mocked(api.createIncident).mockReset();
    vi.mocked(api.searchOfficers).mockReset();
    vi.mocked(api.searchOfficers).mockResolvedValue({ candidates: officerSearchFixtures });
  });

  it("blocks submission and shows an error when department/date/description are missing", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<NewIncidentForm sessionDepartments={[]} sessionOfficers={[]} sessionSources={[]} onCreated={onCreated} />);

    await user.click(screen.getByRole("button", { name: "Create incident" }));

    expect(screen.getByText("Department, date, and description are required.")).toBeInTheDocument();
    expect(api.createIncident).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("blocks submission when no officer has been added, even with the other fields filled in", async () => {
    const user = userEvent.setup();
    render(<NewIncidentForm sessionDepartments={[]} sessionOfficers={[]} sessionSources={[]} onCreated={vi.fn()} />);

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Create incident" }));

    expect(screen.getByText("Add at least one officer (search-and-select above) before submitting.")).toBeInTheDocument();
    expect(api.createIncident).not.toHaveBeenCalled();
  });

  it("adds an officer via the reused OfficerSearchPicker (multi mode) and submits with officerIds populated", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const created = {
      id: "inc-1",
      departmentId: "dept-1",
      date: "2025-06-01",
      incidentType: "use_of_force" as const,
      status: "alleged" as const,
      shortDescription: "Use of force during a traffic stop.",
      officerIds: ["off-204"],
    };
    vi.mocked(api.createIncident).mockResolvedValue({ record: created });
    render(<NewIncidentForm sessionDepartments={[]} sessionOfficers={[]} sessionSources={[]} onCreated={onCreated} />);

    await user.type(screen.getByLabelText("Search for an officer to add"), "Alvar");
    const option = await screen.findByRole("option", { name: /R\. Alvarez/ });
    await user.click(option);
    expect(screen.getByText(/R\. Alvarez/)).toBeInTheDocument();

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Create incident" }));

    const expected: CreateIncidentRequest = {
      departmentId: "dept-1",
      date: "2025-06-01",
      incidentType: "use_of_force",
      status: "alleged",
      shortDescription: "Use of force during a traffic stop.",
      officerIds: ["off-204"],
      sourceIds: undefined,
    };
    await screen.findByText(/Created incident/);
    expect(api.createIncident).toHaveBeenCalledWith(expected);
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it("quick-adds an officer created earlier this session and includes it in officerIds", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createIncident).mockResolvedValue({
      record: {
        id: "inc-2",
        departmentId: "dept-1",
        date: "2025-06-01",
        incidentType: "use_of_force",
        status: "alleged",
        shortDescription: "Use of force during a traffic stop.",
        officerIds: ["off-77"],
      },
    });
    render(
      <NewIncidentForm
        sessionDepartments={[]}
        sessionOfficers={[{ id: "off-77", firstName: "Jordan", lastName: "Lee", departmentId: "dept-1", employmentStatus: "active" }]}
        sessionSources={[]}
        onCreated={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "+ Jordan Lee" }));
    expect(screen.getByText(/Jordan Lee \(just created\)/)).toBeInTheDocument();
    // Once added, it's no longer offered again as a quick-add.
    expect(screen.queryByRole("button", { name: "+ Jordan Lee" })).not.toBeInTheDocument();

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Create incident" }));

    await screen.findByText(/Created incident/);
    expect(api.createIncident).toHaveBeenCalledWith(expect.objectContaining({ officerIds: ["off-77"] }));
  });

  it("removes an added officer via its chip's remove button before submitting", async () => {
    const user = userEvent.setup();
    render(<NewIncidentForm sessionDepartments={[]} sessionOfficers={[]} sessionSources={[]} onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("Search for an officer to add"), "Alvar");
    const option = await screen.findByRole("option", { name: /R\. Alvarez/ });
    await user.click(option);
    expect(screen.getByText(/R\. Alvarez/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Remove R\. Alvarez/ }));
    expect(screen.queryByText(/R\. Alvarez/)).not.toBeInTheDocument();

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Create incident" }));

    expect(screen.getByText("Add at least one officer (search-and-select above) before submitting.")).toBeInTheDocument();
    expect(api.createIncident).not.toHaveBeenCalled();
  });

  it("cites the selected sources when submitting", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createIncident).mockResolvedValue({
      record: {
        id: "inc-3",
        departmentId: "dept-1",
        date: "2025-06-01",
        incidentType: "use_of_force",
        status: "alleged",
        shortDescription: "Use of force during a traffic stop.",
        officerIds: ["off-204"],
        sourceIds: ["src-1"],
      },
    });
    render(
      <NewIncidentForm
        sessionDepartments={[]}
        sessionOfficers={[]}
        sessionSources={[{ id: "src-1", sourceType: "news_article", url: "https://example.org/a", reliabilityTier: "tier3_established_news" }]}
        onCreated={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Search for an officer to add"), "Alvar");
    const option = await screen.findByRole("option", { name: /R\. Alvarez/ });
    await user.click(option);
    await user.click(screen.getByLabelText("https://example.org/a"));

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Create incident" }));

    await screen.findByText(/Created incident/);
    expect(api.createIncident).toHaveBeenCalledWith(expect.objectContaining({ sourceIds: ["src-1"] }));
  });

  it("surfaces an API error instead of swallowing it", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createIncident).mockRejectedValue(new Error("Unknown department ID."));
    render(<NewIncidentForm sessionDepartments={[]} sessionOfficers={[]} sessionSources={[]} onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("Search for an officer to add"), "Alvar");
    const option = await screen.findByRole("option", { name: /R\. Alvarez/ });
    await user.click(option);
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Create incident" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown department ID.");
  });
});
