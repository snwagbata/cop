import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "../AuthContext";
import * as api from "../../api/client";

/** Minimal Response stand-in matching what api/client.ts's request() reads
 * off a fetch() Response (see api/__tests__/client.test.ts). */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const adminReviewer = {
  id: "rev-1",
  name: "Admin Reviewer",
  email: "reviewer@example.org",
  role: "admin" as const,
  active: true,
};

/** Exercises the real AuthContext + api/client integration (not a mocked
 * api module) since the 401-triggers-logout wiring lives at that seam. */
function TestConsumer() {
  const { reviewer, isAuthenticated, login, logout } = useAuth();
  return (
    <div>
      <div data-testid="auth-state">{isAuthenticated ? "authed" : "anon"}</div>
      <div data-testid="reviewer-name">{reviewer?.name ?? "none"}</div>
      <button onClick={() => login("reviewer@example.org", "hunter2").catch(() => {})}>Login</button>
      <button onClick={() => logout()}>Logout</button>
      <button onClick={() => api.fetchReviewers().catch(() => {})}>Fetch reviewers</button>
    </div>
  );
}

describe("AuthContext", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    sessionStorage.clear();
    api.setToken(null);
    api.setUnauthorizedHandler(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("login stores the token+reviewer in sessionStorage and exposes them to consumers", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(200, { token: "tok-1", expiresAt: "2026-01-01T00:00:00.000Z", reviewer: adminReviewer }),
    );

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    expect(screen.getByTestId("auth-state")).toHaveTextContent("anon");

    await user.click(screen.getByText("Login"));

    await waitFor(() => expect(screen.getByTestId("auth-state")).toHaveTextContent("authed"));
    expect(screen.getByTestId("reviewer-name")).toHaveTextContent("Admin Reviewer");
    expect(sessionStorage.getItem("cop_admin_token")).toBe("tok-1");
    expect(JSON.parse(sessionStorage.getItem("cop_admin_reviewer")!)).toEqual(adminReviewer);
    expect(api.getToken()).toBe("tok-1");
  });

  it("logout clears the token, reviewer, and sessionStorage", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(200, { token: "tok-1", expiresAt: "2026-01-01T00:00:00.000Z", reviewer: adminReviewer }),
    );
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    await user.click(screen.getByText("Login"));
    await waitFor(() => expect(screen.getByTestId("auth-state")).toHaveTextContent("authed"));

    await user.click(screen.getByText("Logout"));

    expect(screen.getByTestId("auth-state")).toHaveTextContent("anon");
    expect(screen.getByTestId("reviewer-name")).toHaveTextContent("none");
    expect(sessionStorage.getItem("cop_admin_token")).toBeNull();
    expect(sessionStorage.getItem("cop_admin_reviewer")).toBeNull();
    expect(api.getToken()).toBeNull();
  });

  it("a 401 from any API call (via api/client's unauthorized handler) logs the reviewer out", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { token: "tok-1", expiresAt: "2026-01-01T00:00:00.000Z", reviewer: adminReviewer }),
    );
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    await user.click(screen.getByText("Login"));
    await waitFor(() => expect(screen.getByTestId("auth-state")).toHaveTextContent("authed"));

    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized", message: "Token expired." }));
    await user.click(screen.getByText("Fetch reviewers"));

    await waitFor(() => expect(screen.getByTestId("auth-state")).toHaveTextContent("anon"));
    expect(screen.getByTestId("reviewer-name")).toHaveTextContent("none");
    expect(sessionStorage.getItem("cop_admin_token")).toBeNull();
    expect(api.getToken()).toBeNull();
  });

  it("a non-401 error from an API call does not log the reviewer out", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { token: "tok-1", expiresAt: "2026-01-01T00:00:00.000Z", reviewer: adminReviewer }),
    );
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    await user.click(screen.getByText("Login"));
    await waitFor(() => expect(screen.getByTestId("auth-state")).toHaveTextContent("authed"));

    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "server_error", message: "boom" }));
    await user.click(screen.getByText("Fetch reviewers"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("auth-state")).toHaveTextContent("authed");
    expect(screen.getByTestId("reviewer-name")).toHaveTextContent("Admin Reviewer");
  });

  it("starts authenticated when a token+reviewer are already present (e.g. from a previous session)", () => {
    sessionStorage.setItem("cop_admin_token", "tok-preexisting");
    sessionStorage.setItem("cop_admin_reviewer", JSON.stringify(adminReviewer));
    api.setToken("tok-preexisting");

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    expect(screen.getByTestId("auth-state")).toHaveTextContent("authed");
    expect(screen.getByTestId("reviewer-name")).toHaveTextContent("Admin Reviewer");
  });
});
