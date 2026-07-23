import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CreateOutcomeRequest } from "@cop/shared-types";
import { NewOutcomeForm } from "../NewOutcomeForm";
import * as api from "../../../api/client";

vi.mock("../../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/client")>("../../../api/client");
  return {
    ...actual,
    createOutcome: vi.fn(),
  };
});

describe("NewOutcomeForm", () => {
  beforeEach(() => {
    vi.mocked(api.createOutcome).mockReset();
  });

  it("blocks submission and shows an error when the incident ID is missing", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<NewOutcomeForm sessionIncidents={[]} sessionSources={[]} onCreated={onCreated} />);

    await user.click(screen.getByRole("button", { name: "Create outcome" }));

    expect(screen.getByText(/An incident ID is required/)).toBeInTheDocument();
    expect(api.createOutcome).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("blocks submission with a negative amount", async () => {
    // The amount input carries min="0", so a real click on the submit button
    // never reaches handleSubmit at all — the browser's own constraint
    // validation blocks it first (confirmed via manual testing; see report).
    // Submitting the form directly is the only way to exercise this app-level
    // check, which is otherwise dead code from a real user's perspective.
    const user = userEvent.setup();
    render(<NewOutcomeForm sessionIncidents={[]} sessionSources={[]} onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("Incident ID"), "inc-1");
    await user.type(screen.getByLabelText("Amount, USD (optional)"), "-5");
    fireEvent.submit(screen.getByRole("button", { name: "Create outcome" }).closest("form")!);

    expect(screen.getByText("Amount must be a non-negative number (in dollars).")).toBeInTheDocument();
    expect(api.createOutcome).not.toHaveBeenCalled();
  });

  it("submits a correctly-shaped CreateOutcomeRequest with only the required field set, and calls onCreated", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const created = { id: "out-1", incidentId: "inc-1", outcomeType: "internal_discipline" as const };
    vi.mocked(api.createOutcome).mockResolvedValue({ record: created });
    render(<NewOutcomeForm sessionIncidents={[]} sessionSources={[]} onCreated={onCreated} />);

    await user.type(screen.getByLabelText("Incident ID"), "inc-1");
    await user.click(screen.getByRole("button", { name: "Create outcome" }));

    const expected: CreateOutcomeRequest = {
      incidentId: "inc-1",
      outcomeType: "internal_discipline",
      date: undefined,
      amountCents: undefined,
      details: undefined,
      sourceIds: undefined,
    };
    await screen.findByText(/Created outcome/);
    expect(api.createOutcome).toHaveBeenCalledWith(expected);
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it("converts a dollar amount to whole cents", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createOutcome).mockResolvedValue({
      record: { id: "out-2", incidentId: "inc-1", outcomeType: "lawsuit_settlement" },
    });
    render(<NewOutcomeForm sessionIncidents={[]} sessionSources={[]} onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("Incident ID"), "inc-1");
    await user.selectOptions(screen.getByLabelText("Outcome type"), "lawsuit_settlement");
    await user.type(screen.getByLabelText(/Amount, USD/), "250.50");
    await user.click(screen.getByRole("button", { name: "Create outcome" }));

    await screen.findByText(/Created outcome/);
    expect(api.createOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcomeType: "lawsuit_settlement", amountCents: 25050 }),
    );
  });

  it("offers incidents created earlier this session in the incident id datalist", () => {
    const { container } = render(
      <NewOutcomeForm
        sessionIncidents={[
          { id: "inc-1", departmentId: "dept-1", date: "2025-01-01", incidentType: "use_of_force", shortDescription: "Use of force during a traffic stop", officerIds: ["off-1"] },
        ]}
        sessionSources={[]}
        onCreated={vi.fn()}
      />,
    );
    const option = container.querySelector('datalist#session-incidents option[value="inc-1"]');
    expect(option).not.toBeNull();
  });

  it("cites the selected sources when submitting", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createOutcome).mockResolvedValue({
      record: { id: "out-3", incidentId: "inc-1", outcomeType: "internal_discipline" },
    });
    render(
      <NewOutcomeForm
        sessionIncidents={[]}
        sessionSources={[{ id: "src-1", sourceType: "news_article", url: "https://example.org/a", reliabilityTier: "tier3_established_news" }]}
        onCreated={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Incident ID"), "inc-1");
    await user.click(screen.getByLabelText("https://example.org/a"));
    await user.click(screen.getByRole("button", { name: "Create outcome" }));

    await screen.findByText(/Created outcome/);
    expect(api.createOutcome).toHaveBeenCalledWith(expect.objectContaining({ sourceIds: ["src-1"] }));
  });

  it("surfaces an API error instead of swallowing it", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createOutcome).mockRejectedValue(new Error("Unknown incident ID."));
    render(<NewOutcomeForm sessionIncidents={[]} sessionSources={[]} onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("Incident ID"), "inc-unknown");
    await user.click(screen.getByRole("button", { name: "Create outcome" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown incident ID.");
  });
});
