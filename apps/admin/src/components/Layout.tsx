import { useState, type ReactNode } from "react";
import { NavLink, type NavLinkRenderProps } from "react-router";
import { useAuth } from "../context/AuthContext";

function navLinkClassName({ isActive }: NavLinkRenderProps): string {
  return isActive ? "active" : "";
}

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
            <NavLink to="/" end className={navLinkClassName}>
              Dashboard
            </NavLink>
            <NavLink to="/review-queue" className={navLinkClassName}>
              Review Queue
            </NavLink>
            <NavLink to="/disputes" className={navLinkClassName}>
              Disputes
            </NavLink>
            <NavLink to="/new-record" className={navLinkClassName}>
              New Record
            </NavLink>
            <NavLink to="/audit-log" className={navLinkClassName}>
              Audit Log
            </NavLink>
            <NavLink to="/photo-review" className={navLinkClassName}>
              Photo Review
            </NavLink>
            <NavLink to="/officers" className={navLinkClassName}>
              Officers
            </NavLink>
            <NavLink to="/ingestion-runs" className={navLinkClassName}>
              Ingestion Runs
            </NavLink>
            {isAdmin && (
              <NavLink to="/reviewers" className={navLinkClassName}>
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
