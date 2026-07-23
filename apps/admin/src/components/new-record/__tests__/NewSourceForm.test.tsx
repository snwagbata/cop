import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CreateSourceRequest } from "@cop/shared-types";
import { NewSourceForm } from "../NewSourceForm";
import * as api from "../../../api/client";

vi.mock("../../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/client")>("../../../api/client");
  return {
    ...actual,
    createSource: vi.fn(),
  };
});

describe("NewSourceForm", () => {
  beforeEach(() => {
    vi.mocked(api.createSource).mockReset();
  });

  it("blocks submission and shows an error when the URL is missing", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<NewSourceForm onCreated={onCreated} />);

    await user.click(screen.getByRole("button", { name: "Create source" }));

    expect(screen.getByText("A source URL is required.")).toBeInTheDocument();
    expect(api.createSource).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("submits a correctly-shaped CreateSourceRequest with defaults, shows the created record, and calls onCreated", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const created = {
      id: "src-1",
      sourceType: "news_article" as const,
      url: "https://example.org/article",
      reliabilityTier: "tier3_established_news" as const,
    };
    vi.mocked(api.createSource).mockResolvedValue({ record: created });
    render(<NewSourceForm onCreated={onCreated} />);

    await user.type(screen.getByLabelText("URL"), "https://example.org/article");
    await user.click(screen.getByRole("button", { name: "Create source" }));

    const expected: CreateSourceRequest = {
      sourceType: "news_article",
      url: "https://example.org/article",
      publicationDate: undefined,
      retrievedDate: undefined,
      reliabilityTier: "tier3_established_news",
    };
    await screen.findByText(/Created source/);
    expect(api.createSource).toHaveBeenCalledWith(expected);
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it("submits the selected source type / reliability tier and optional dates", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createSource).mockResolvedValue({
      record: { id: "src-2", sourceType: "court_doc", url: "https://example.org/doc", reliabilityTier: "tier1_primary_legal_doc" },
    });
    render(<NewSourceForm onCreated={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText("Source type"), "court_doc");
    await user.selectOptions(screen.getByLabelText("Reliability tier"), "tier1_primary_legal_doc");
    await user.type(screen.getByLabelText("URL"), "https://example.org/doc");
    await user.type(screen.getByLabelText(/Publication date/), "2025-01-15");
    await user.type(screen.getByLabelText(/Retrieved date/), "2025-06-01");
    await user.click(screen.getByRole("button", { name: "Create source" }));

    await screen.findByText(/Created source/);
    expect(api.createSource).toHaveBeenCalledWith({
      sourceType: "court_doc",
      url: "https://example.org/doc",
      publicationDate: "2025-01-15",
      retrievedDate: "2025-06-01",
      reliabilityTier: "tier1_primary_legal_doc",
    });
  });

  it("surfaces an API error instead of swallowing it", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createSource).mockRejectedValue(new Error("This URL has already been cited."));
    render(<NewSourceForm onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("URL"), "https://example.org/dup");
    await user.click(screen.getByRole("button", { name: "Create source" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This URL has already been cited.");
  });
});
