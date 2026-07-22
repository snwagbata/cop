import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Reviewer } from "@cop/shared-types";
import * as api from "../api/client";

const REVIEWER_STORAGE_KEY = "cop_admin_reviewer";

interface AuthContextValue {
  reviewer: Reviewer | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadStoredReviewer(): Reviewer | null {
  const raw = sessionStorage.getItem(REVIEWER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Reviewer;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [reviewer, setReviewer] = useState<Reviewer | null>(() =>
    api.getToken() ? loadStoredReviewer() : null,
  );

  const logout = useCallback(() => {
    api.setToken(null);
    sessionStorage.removeItem(REVIEWER_STORAGE_KEY);
    setReviewer(null);
  }, []);

  // Any 401 from the API client (expired/invalid token) drops us back to
  // the login page, per the task spec.
  useEffect(() => {
    api.setUnauthorizedHandler(() => {
      logout();
    });
    return () => api.setUnauthorizedHandler(null);
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login({ email, password });
    api.setToken(res.token);
    sessionStorage.setItem(REVIEWER_STORAGE_KEY, JSON.stringify(res.reviewer));
    setReviewer(res.reviewer);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      reviewer,
      isAuthenticated: reviewer !== null && api.getToken() !== null,
      login,
      logout,
    }),
    [reviewer, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
