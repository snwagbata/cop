import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CreateDepartmentRequest } from "@cop/shared-types";
import { NewDepartmentForm } from "../NewDepartmentForm";
import * as api from "../../../api/client";

vi.mock("../../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/client")>("../../../api/client");
  return {
    ...actual,
    createDepartment: vi.fn(),
  };
});

describe("NewDepartmentForm", () => {
  beforeEach(() => {
    vi.mocked(api.createDepartment).mockReset();
  });

  it("blocks submission and shows an error when required fields are missing", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<NewDepartmentForm onCreated={onCreated} />);

    await user.click(screen.getByRole("button", { name: "Create department" }));

    expect(screen.getByText("Name, state, and jurisdiction type are required.")).toBeInTheDocument();
    expect(api.createDepartment).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("submits a correctly-shaped CreateDepartmentRequest, shows the created record, and calls onCreated", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const created = {
      id: "dept-1",
      name: "Riverdale PD",
      state: "CA",
      jurisdictionType: "municipal",
    };
    vi.mocked(api.createDepartment).mockResolvedValue({ record: created });
    render(<NewDepartmentForm onCreated={onCreated} />);

    await user.type(screen.getByLabelText("Name"), "Riverdale PD");
    await user.type(screen.getByLabelText("State"), "CA");
    await user.type(screen.getByLabelText("Jurisdiction type"), "municipal");
    await user.click(screen.getByRole("button", { name: "Create department" }));

    const expected: CreateDepartmentRequest = {
      name: "Riverdale PD",
      state: "CA",
      jurisdictionType: "municipal",
      contactInfo: undefined,
      recordsRequestPortalUrl: undefined,
    };
    await screen.findByText(/Created department/);
    expect(api.createDepartment).toHaveBeenCalledWith(expected);
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(screen.getByRole("status")).toHaveTextContent("Created department dept-1 — Riverdale PD.");
  });

  it("includes optional fields, trimmed, when provided", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createDepartment).mockResolvedValue({
      record: { id: "dept-2", name: "Fairview SO", state: "CA", jurisdictionType: "county sheriff" },
    });
    render(<NewDepartmentForm onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("Name"), "Fairview SO");
    await user.type(screen.getByLabelText("State"), "CA");
    await user.type(screen.getByLabelText("Jurisdiction type"), "county sheriff");
    await user.type(screen.getByLabelText("Contact info (optional)"), "  records@fairview.gov  ");
    await user.type(screen.getByLabelText("Records request portal URL (optional)"), "https://fairview.gov/records");
    await user.click(screen.getByRole("button", { name: "Create department" }));

    await screen.findByText(/Created department/);
    expect(api.createDepartment).toHaveBeenCalledWith(
      expect.objectContaining({
        contactInfo: "records@fairview.gov",
        recordsRequestPortalUrl: "https://fairview.gov/records",
      }),
    );
  });

  it("surfaces an API error instead of swallowing it", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createDepartment).mockRejectedValue(new Error("A department with this name already exists."));
    render(<NewDepartmentForm onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("Name"), "Riverdale PD");
    await user.type(screen.getByLabelText("State"), "CA");
    await user.type(screen.getByLabelText("Jurisdiction type"), "municipal");
    await user.click(screen.getByRole("button", { name: "Create department" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("A department with this name already exists.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
