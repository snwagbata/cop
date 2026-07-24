import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PhotoReviewPage } from "../PhotoReviewPage";
import { pendingPhotosFixtures } from "../../fixtures/pendingPhotos";
import * as api from "../../api/client";
import { ApiError } from "../../api/client";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return {
    ...actual,
    fetchPendingPhotos: vi.fn(),
    confirmOfficerPhoto: vi.fn(),
    rejectOfficerPhoto: vi.fn(),
  };
});

describe("PhotoReviewPage", () => {
  beforeEach(() => {
    vi.mocked(api.fetchPendingPhotos).mockResolvedValue({ officers: pendingPhotosFixtures });
    vi.mocked(api.confirmOfficerPhoto).mockResolvedValue({
      officer: { id: "off-1", photoUrl: pendingPhotosFixtures[0].photoUrl, photoConfirmed: true },
    });
    vi.mocked(api.rejectOfficerPhoto).mockResolvedValue({
      officer: { id: "off-1", photoUrl: null, photoConfirmed: false },
    });
  });

  it("shows a loading state before the fetch resolves", async () => {
    let resolveFetch: (value: { officers: typeof pendingPhotosFixtures }) => void = () => {};
    vi.mocked(api.fetchPendingPhotos).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    render(
      <MemoryRouter>
        <PhotoReviewPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
    resolveFetch({ officers: pendingPhotosFixtures });
    await screen.findByTestId("photo-review-off-1");
  });

  it("loads and renders all pending-photo officers from the fixture data", async () => {
    render(
      <MemoryRouter>
        <PhotoReviewPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(api.fetchPendingPhotos).toHaveBeenCalled());
    for (const officer of pendingPhotosFixtures) {
      expect(await screen.findByTestId(`photo-review-${officer.id}`)).toBeInTheDocument();
    }
  });

  it("shows an empty state when there are no pending photos", async () => {
    vi.mocked(api.fetchPendingPhotos).mockResolvedValueOnce({ officers: [] });
    render(
      <MemoryRouter>
        <PhotoReviewPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Nothing pending/)).toBeInTheDocument();
  });

  it("shows a top-level error banner when the initial fetch fails", async () => {
    vi.mocked(api.fetchPendingPhotos).mockRejectedValueOnce(new Error("Could not reach the internal API"));
    render(
      <MemoryRouter>
        <PhotoReviewPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not reach the internal API/);
  });

  it("removes an item from the list after a successful confirm", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PhotoReviewPage />
      </MemoryRouter>,
    );
    await screen.findByTestId("photo-review-off-1");

    const card = screen.getByTestId("photo-review-off-1");
    await user.click(within(card).getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(screen.queryByTestId("photo-review-off-1")).not.toBeInTheDocument());
    expect(api.confirmOfficerPhoto).toHaveBeenCalledWith("off-1");
    // The other item is untouched.
    expect(screen.getByTestId("photo-review-off-2")).toBeInTheDocument();
  });

  it("removes an item from the list after a successful reject", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PhotoReviewPage />
      </MemoryRouter>,
    );
    await screen.findByTestId("photo-review-off-1");

    const card = screen.getByTestId("photo-review-off-1");
    await user.click(within(card).getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(screen.queryByTestId("photo-review-off-1")).not.toBeInTheDocument());
    expect(api.rejectOfficerPhoto).toHaveBeenCalledWith("off-1");
  });

  it("shows an inline error on the card when confirm fails, and keeps the item in the list", async () => {
    const user = userEvent.setup();
    vi.mocked(api.confirmOfficerPhoto).mockRejectedValueOnce(
      new ApiError(400, { error: "already_confirmed", message: "photo already confirmed" }, "fallback"),
    );
    render(
      <MemoryRouter>
        <PhotoReviewPage />
      </MemoryRouter>,
    );
    const card = await screen.findByTestId("photo-review-off-1");

    await user.click(within(card).getByRole("button", { name: "Confirm" }));

    expect(await within(card).findByRole("alert")).toHaveTextContent(/photo already confirmed/);
    expect(screen.getByTestId("photo-review-off-1")).toBeInTheDocument();
  });

  it("shows an inline error on the card when reject fails, and keeps the item in the list", async () => {
    const user = userEvent.setup();
    vi.mocked(api.rejectOfficerPhoto).mockRejectedValueOnce(
      new ApiError(404, { error: "not_found", message: "officer not found" }, "fallback"),
    );
    render(
      <MemoryRouter>
        <PhotoReviewPage />
      </MemoryRouter>,
    );
    const card = await screen.findByTestId("photo-review-off-1");

    await user.click(within(card).getByRole("button", { name: "Reject" }));

    expect(await within(card).findByRole("alert")).toHaveTextContent(/officer not found/);
    expect(screen.getByTestId("photo-review-off-1")).toBeInTheDocument();
  });
});
