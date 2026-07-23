import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { LoginPage } from "../LoginPage";

const mockLogin = vi.fn();
const mockNavigate = vi.fn();

vi.mock("../../context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("../../context/AuthContext")>("../../context/AuthContext");
  return {
    ...actual,
    useAuth: () => ({
      reviewer: null,
      isAuthenticated: false,
      login: mockLogin,
      logout: vi.fn(),
    }),
  };
});

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("LoginPage", () => {
  beforeEach(() => {
    mockLogin.mockReset();
    mockNavigate.mockReset();
  });

  it("blocks submission and does not call login when email/password are empty", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("submits valid credentials, calls the auth API via login(), and navigates away from login", async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Email"), "reviewer@example.org");
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith("reviewer@example.org", "hunter2"));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true }));
  });

  it("navigates back to the originally-requested page (location state) after login", async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue(undefined);
    render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: { from: "/disputes" } }]}>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Email"), "reviewer@example.org");
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/disputes", { replace: true }));
  });

  it("shows an error and does not navigate when credentials are invalid", async () => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValue(new Error("Invalid email or password."));
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Email"), "reviewer@example.org");
    await user.type(screen.getByLabelText("Password"), "wrongpassword");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows a generic error when login rejects with a non-Error value", async () => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValue("boom");
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Email"), "reviewer@example.org");
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Login failed.");
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
