import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CreateOfficerRequest } from "@cop/shared-types";
import { NewOfficerForm } from "../NewOfficerForm";
import * as api from "../../../api/client";

vi.mock("../../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/client")>("../../../api/client");
  return {
    ...actual,
    createOfficer: vi.fn(),
  };
});

describe("NewOfficerForm", () => {
  beforeEach(() => {
    vi.mocked(api.createOfficer).mockReset();
  });

  it("blocks submission and shows an error when required fields are missing", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<NewOfficerForm sessionDepartments={[]} onCreated={onCreated} />);

    await user.click(screen.getByRole("button", { name: "Create officer" }));

    expect(screen.getByText("First name, last name, and department ID are required.")).toBeInTheDocument();
    expect(api.createOfficer).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("submits a correctly-shaped CreateOfficerRequest, shows the created record, and calls onCreated", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const created = { id: "off-1", firstName: "Jordan", lastName: "Lee", departmentId: "dept-1", employmentStatus: "active" as const };
    vi.mocked(api.createOfficer).mockResolvedValue({ record: created });
    render(<NewOfficerForm sessionDepartments={[]} onCreated={onCreated} />);

    await user.type(screen.getByLabelText("First name"), "Jordan");
    await user.type(screen.getByLabelText("Last name"), "Lee");
    await user.type(screen.getByLabelText("Department ID"), "dept-1");
    await user.click(screen.getByRole("button", { name: "Create officer" }));

    const expected: CreateOfficerRequest = {
      firstName: "Jordan",
      lastName: "Lee",
      departmentId: "dept-1",
      badgeNumber: undefined,
      rank: undefined,
      hireDate: undefined,
      employmentStatus: "active",
      postCertificationId: undefined,
      photoUrl: undefined,
    };
    await screen.findByText(/Created officer/);
    expect(api.createOfficer).toHaveBeenCalledWith(expected);
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(screen.getByRole("status")).toHaveTextContent("Created officer off-1 — Jordan Lee.");
  });

  it("offers departments created earlier this session in the department id datalist", () => {
    const { container } = render(
      <NewOfficerForm
        sessionDepartments={[{ id: "dept-7", name: "Riverdale PD", state: "CA", jurisdictionType: "municipal" }]}
        onCreated={vi.fn()}
      />,
    );
    const option = container.querySelector('datalist#session-departments option[value="dept-7"]');
    expect(option).not.toBeNull();
    expect(option?.textContent).toBe("Riverdale PD");
  });

  it("submits optional fields, trimmed, when provided", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createOfficer).mockResolvedValue({
      record: { id: "off-2", firstName: "R.", lastName: "Alvarez", departmentId: "dept-2" },
    });
    render(<NewOfficerForm sessionDepartments={[]} onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("First name"), "R.");
    await user.type(screen.getByLabelText("Last name"), "Alvarez");
    await user.type(screen.getByLabelText("Department ID"), "dept-2");
    await user.type(screen.getByLabelText("Badge number (optional)"), " 1187 ");
    await user.type(screen.getByLabelText("Rank (optional)"), "Deputy");
    await user.selectOptions(screen.getByLabelText("Employment status"), "retired");
    await user.type(screen.getByLabelText("POST/certification ID (optional)"), "PC-99");
    await user.click(screen.getByRole("button", { name: "Create officer" }));

    await screen.findByText(/Created officer/);
    expect(api.createOfficer).toHaveBeenCalledWith(
      expect.objectContaining({
        badgeNumber: "1187",
        rank: "Deputy",
        employmentStatus: "retired",
        postCertificationId: "PC-99",
      }),
    );
  });

  it("surfaces an API error instead of swallowing it", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createOfficer).mockRejectedValue(new Error("Unknown department ID."));
    render(<NewOfficerForm sessionDepartments={[]} onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("First name"), "Jordan");
    await user.type(screen.getByLabelText("Last name"), "Lee");
    await user.type(screen.getByLabelText("Department ID"), "dept-unknown");
    await user.click(screen.getByRole("button", { name: "Create officer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown department ID.");
  });
});
