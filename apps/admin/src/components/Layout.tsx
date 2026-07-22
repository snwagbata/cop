import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function Layout({ children }: { children: ReactNode }) {
  const { reviewer, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <span className="topbar-brand">COP Admin</span>
          <nav>
            <NavLink to="/review-queue" className={({ isActive }) => (isActive ? "active" : "")}>
              Review Queue
            </NavLink>
            <NavLink to="/disputes" className={({ isActive }) => (isActive ? "active" : "")}>
              Disputes
            </NavLink>
          </nav>
        </div>
        <div className="topbar-right">
          {reviewer && (
            <span>
              {reviewer.name} ({reviewer.role})
            </span>
          )}
          <button type="button" className="btn-link" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <main className="page">{children}</main>
    </div>
  );
}
