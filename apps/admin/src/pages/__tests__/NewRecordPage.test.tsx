import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { NewRecordPage } from "../NewRecordPage";
import * as api from "../../api/client";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return {
    ...actual,
    createDepartment: vi.fn(),
    createSource: vi.fn(),
    createOfficer: vi.fn(),
    createIncident: vi.fn(),
    createOutcome: vi.fn(),
  };
});

describe("NewRecordPage", () => {
  beforeEach(() => {
    vi.mocked(api.createDepartment).mockReset();
    vi.mocked(api.createSource).mockReset();
    vi.mocked(api.createOfficer).mockReset();
  });

  it("renders the Source form by default, and switches the active step's form on tab click", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <NewRecordPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "New source" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "1. Source" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: "2. Department" }));
    expect(screen.getByRole("heading", { name: "New department" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "2. Department" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "1. Source" })).toHaveAttribute("aria-selected", "false");

    await user.click(screen.getByRole("tab", { name: "3. Officer" }));
    expect(screen.getByRole("heading", { name: "New officer" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "4. Incident" }));
    expect(screen.getByRole("heading", { name: "New incident" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "5. Outcome" }));
    expect(screen.getByRole("heading", { name: "New outcome (optional)" })).toBeInTheDocument();
  });

  it("makes a department created in step 2 selectable when creating an officer in step 3", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createDepartment).mockResolvedValue({
      record: { id: "dept-99", name: "Test PD", state: "CA", jurisdictionType: "municipal" },
    });
    const { container } = render(
      <MemoryRouter>
        <NewRecordPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("tab", { name: "2. Department" }));
    await user.type(screen.getByLabelText("Name"), "Test PD");
    await user.type(screen.getByLabelText("State"), "CA");
    await user.type(screen.getByLabelText("Jurisdiction type"), "municipal");
    await user.click(screen.getByRole("button", { name: "Create department" }));

    expect(await screen.findByText(/Created department/)).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "3. Officer" }));

    const option = container.querySelector('#session-departments option[value="dept-99"]');
    expect(option).not.toBeNull();
    expect(option?.textContent).toBe("Test PD");
  });

  it("shows a running per-type session summary as records are created", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createSource).mockResolvedValue({
      record: { id: "src-1", sourceType: "news_article", url: "https://example.org/a", reliabilityTier: "tier3_established_news" },
    });
    const { container } = render(
      <MemoryRouter>
        <NewRecordPage />
      </MemoryRouter>,
    );

    expect(container.querySelector(".session-summary")).toBeNull();

    await user.type(screen.getByLabelText("URL"), "https://example.org/a");
    await user.click(screen.getByRole("button", { name: "Create source" }));

    await screen.findByText(/Created source/);
    expect(container.querySelector(".session-summary")?.textContent).toBe(
      "Created this session: 1 source(s), 0 department(s), 0 officer(s), 0 incident(s).",
    );
  });
});
