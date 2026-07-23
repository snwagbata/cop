import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuditLogPage } from "../AuditLogPage";
import { revisionFixtures } from "../../fixtures/revisions";
import * as api from "../../api/client";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return {
    ...actual,
    fetchRecordRevisions: vi.fn(),
  };
});

describe("AuditLogPage", () => {
  beforeEach(() => {
    vi.mocked(api.fetchRecordRevisions).mockResolvedValue({
      revisions: revisionFixtures,
      pageInfo: { page: 1, pageSize: 25, totalCount: 2 },
    });
  });

  it("loads and lists revisions with record type, change type, who, and when", async () => {
    render(<AuditLogPage />);
    await waitFor(() => expect(api.fetchRecordRevisions).toHaveBeenCalled());

    expect(await screen.findByText("off-204")).toBeInTheDocument();
    expect(screen.getByText("inc-101")).toBeInTheDocument();
    expect(screen.getAllByText("Admin Reviewer")).toHaveLength(2);
  });

  it("expands a diff view on demand", async () => {
    const user = userEvent.setup();
    render(<AuditLogPage />);
    await screen.findByText("off-204");

    expect(screen.queryByText(/"firstName": "Jordan"/)).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Show diff" })[0]);
    expect(screen.getByText(/"firstName": "Jordan"/)).toBeInTheDocument();
  });

  it("re-fetches with the recordType filter when changed", async () => {
    const user = userEvent.setup();
    render(<AuditLogPage />);
    await screen.findByText("off-204");

    await user.selectOptions(screen.getByLabelText("Filter by record type"), "incident");
    await waitFor(() =>
      expect(api.fetchRecordRevisions).toHaveBeenLastCalledWith({
        recordType: "incident",
        page: 1,
        pageSize: 25,
      }),
    );
  });
});
