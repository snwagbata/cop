import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { IngestionRun } from "@cop/shared-types";
import { IngestionRunsPage } from "../IngestionRunsPage";
import * as api from "../../api/client";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return {
    ...actual,
    fetchIngestionRuns: vi.fn(),
  };
});

const completedRun: IngestionRun = {
  id: "run-1",
  sourceType: "court_doc",
  startedAt: "2026-07-20T09:00:00.000Z",
  finishedAt: "2026-07-20T09:04:00.000Z",
  itemsFetched: 12,
  itemsQueued: 3,
  itemsDeduped: 9,
  error: null,
};

const inProgressRun: IngestionRun = {
  id: "run-2",
  sourceType: "news_article",
  startedAt: "2026-07-24T08:00:00.000Z",
  finishedAt: null,
  itemsFetched: 0,
  itemsQueued: 0,
  itemsDeduped: 0,
  error: null,
};

const erroredRun: IngestionRun = {
  id: "run-3",
  sourceType: "decertification_registry",
  startedAt: "2026-07-19T12:00:00.000Z",
  finishedAt: "2026-07-19T12:01:00.000Z",
  itemsFetched: 5,
  itemsQueued: 0,
  itemsDeduped: 0,
  error: "Upstream API returned 403.",
};

// IngestionRunsPage renders <Breadcrumbs>, which uses react-router-dom's
// <Link> -- every render here needs a <MemoryRouter> wrapper, same
// requirement AuditLogPage.test.tsx and PhotoReviewPage.test.tsx already
// document (this has bitten prior feature rounds in this codebase).
function renderPage() {
  return render(
    <MemoryRouter>
      <IngestionRunsPage />
    </MemoryRouter>,
  );
}

describe("IngestionRunsPage", () => {
  beforeEach(() => {
    vi.mocked(api.fetchIngestionRuns).mockResolvedValue({ runs: [] });
  });

  it("shows a loading state before the fetch resolves", async () => {
    let resolveFetch: (value: { runs: IngestionRun[] }) => void = () => {};
    vi.mocked(api.fetchIngestionRuns).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    renderPage();
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
    resolveFetch({ runs: [] });
    await waitFor(() => expect(screen.queryByText(/Loading/)).not.toBeInTheDocument());
  });

  it("shows a clear 'no runs yet' empty state when nothing has run (expected pre-pipeline state)", async () => {
    renderPage();
    expect(await screen.findByText(/No ingestion runs yet/)).toBeInTheDocument();
  });

  it("lists runs with source, status, timing, and counts", async () => {
    vi.mocked(api.fetchIngestionRuns).mockResolvedValue({ runs: [completedRun, inProgressRun, erroredRun] });
    renderPage();

    expect(await screen.findByText("court_doc")).toBeInTheDocument();
    expect(screen.getByText("news_article")).toBeInTheDocument();
    expect(screen.getByText("decertification_registry")).toBeInTheDocument();

    // Counts for the completed run.
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("labels a still-running (finishedAt null) run distinctly from a completed one", async () => {
    vi.mocked(api.fetchIngestionRuns).mockResolvedValue({ runs: [completedRun, inProgressRun] });
    renderPage();

    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("surfaces an errored run's status and error message", async () => {
    vi.mocked(api.fetchIngestionRuns).mockResolvedValue({ runs: [erroredRun] });
    renderPage();

    expect(await screen.findByText("Errored")).toBeInTheDocument();
    expect(screen.getByText("Upstream API returned 403.")).toBeInTheDocument();
  });

  it("shows a top-level error banner when the fetch fails", async () => {
    vi.mocked(api.fetchIngestionRuns).mockRejectedValueOnce(new Error("Could not reach the internal API"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not reach the internal API/);
  });
});
