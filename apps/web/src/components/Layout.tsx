import { useState, type ReactNode } from "react";
import { Link } from "react-router";

export function Layout({ children }: { children: ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="site-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className={`top-nav${mobileMenuOpen ? " is-open" : ""}`}>
        <Link className="brand" to="/">
          COP — Officer Accountability Database
        </Link>
        <button
          type="button"
          className="nav-toggle"
          aria-expanded={mobileMenuOpen}
          aria-controls="primary-nav"
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
          <Link to="/">Search</Link>
          <Link to="/departments">Departments</Link>
          <Link to="/about">About &amp; Methodology</Link>
          <Link to="/tips/new">Submit a Tip</Link>
          <Link to="/disputes/new">Correction Request</Link>
          <Link to="/disputes/status">Check Dispute Status</Link>
        </nav>
      </header>
      <main id="main" className="container">
        {children}
      </main>
      <footer className="site-footer">
        Records are sourced from public documents. See each record's citations for sources, and use the{" "}
        <Link to="/disputes/new">correction request form</Link> to dispute anything inaccurate, or{" "}
        <Link to="/disputes/status">check the status</Link> of a request you already submitted.
      </footer>
    </div>
  );
}
