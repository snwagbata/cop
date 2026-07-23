import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="site-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="top-nav">
        <Link className="brand" to="/">
          COP — Officer Accountability Database
        </Link>
        <nav className="top-nav-links" aria-label="Primary">
          <Link to="/">Search</Link>
          <Link to="/departments">Departments</Link>
          <Link to="/about">About &amp; Methodology</Link>
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
