import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="site-shell">
      <header className="site-header">
        <Link className="site-header__brand" to="/">
          COP — Officer Accountability Database
        </Link>
        <nav className="site-header__nav">
          <Link to="/">Search</Link>
          <Link to="/departments">Departments</Link>
          <Link to="/disputes/new">Correction Request</Link>
        </nav>
      </header>
      <main className="container">{children}</main>
      <footer className="site-footer">
        Records are sourced from public documents. See each record's citations for sources, and use the{" "}
        <Link to="/disputes/new">correction request form</Link> to dispute anything inaccurate.
      </footer>
    </div>
  );
}
