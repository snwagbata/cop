import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function Layout({ children }: { children: ReactNode }) {
  const { reviewer, logout } = useAuth();
  const isAdmin = reviewer?.role === "admin";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className={`top-nav${mobileMenuOpen ? " is-open" : ""}`}>
        <div className="top-nav-left">
          <span className="brand">COP Admin</span>
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={mobileMenuOpen}
            aria-controls="primary-nav admin-user-panel"
            aria-label="Toggle navigation"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            <span className="nav-toggle-bar" />
          </button>
          <nav
            className="top-nav-links"
            aria-label="Primary"
            id="primary-nav"
            onClick={() => setMobileMenuOpen(false)}
          >
            <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
              Dashboard
            </NavLink>
            <NavLink to="/review-queue" className={({ isActive }) => (isActive ? "active" : "")}>
              Review Queue
            </NavLink>
            <NavLink to="/disputes" className={({ isActive }) => (isActive ? "active" : "")}>
              Disputes
            </NavLink>
            <NavLink to="/new-record" className={({ isActive }) => (isActive ? "active" : "")}>
              New Record
            </NavLink>
            <NavLink to="/audit-log" className={({ isActive }) => (isActive ? "active" : "")}>
              Audit Log
            </NavLink>
            <NavLink to="/photo-review" className={({ isActive }) => (isActive ? "active" : "")}>
              Photo Review
            </NavLink>
            <NavLink to="/ingestion-runs" className={({ isActive }) => (isActive ? "active" : "")}>
              Ingestion Runs
            </NavLink>
            {isAdmin && (
              <NavLink to="/reviewers" className={({ isActive }) => (isActive ? "active" : "")}>
                Reviewers
              </NavLink>
            )}
          </nav>
        </div>
        <div className="top-nav-right" id="admin-user-panel">
          {reviewer && (
            <span className="text-muted">
              {reviewer.name} ({reviewer.role})
            </span>
          )}
          <button type="button" className="btn-link" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <main id="main" className="page container-wide">
        {children}
      </main>
    </div>
  );
}
