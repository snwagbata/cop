import { Link } from "react-router-dom";
import { Breadcrumbs } from "../components/Breadcrumbs";

/**
 * About / Methodology page (DESIGN.md §12 backlog: "Public methodology/
 * sourcing-standards page explaining the tier system and review process —
 * doubles as a legal-defense artifact demonstrating systematic diligence,
 * alongside record_revisions"). Static content, no API call — written in a
 * plain, non-defensive register per the task brief.
 */
export function AboutPage() {
  return (
    <div>
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "About & Methodology" }]} />
      <h1 className="page-title">About &amp; Methodology</h1>
      <p className="subtitle">
        What this database is, how a record gets published, and what to do if you think one is wrong.
      </p>

      <section className="page-section">
        <h2>What this is</h2>
        <p>
          COP is a public-interest database that tracks law enforcement officers alongside documented incidents of
          misconduct, sustained complaints, lawsuits, and disciplinary outcomes. It is built from public records,
          court filings, and news coverage — every record on this site links to the source document it came from.
        </p>
        <p>
          It is not a real-time surveillance tool, not a place for unverified allegations, and not a source of
          individual officer ratings or risk scores. A department's aggregate accountability record (total
          settlements, sustained-complaint counts) is presented as raw counts and totals only — never a grade or
          ranking — because department-level aggregation of already-published, sourced facts is a fundamentally
          different, lower-risk category than rating a person.
        </p>
      </section>

      <section className="page-section">
        <h2>Source reliability tiers</h2>
        <p>
          Every incident and outcome on this site carries at least one citation, and each citation's source is
          assigned one of four reliability tiers. The tier determines how much scrutiny a record gets before it can
          be published — higher tiers can move through review faster; lower tiers always get a full manual look.
        </p>

        <div className="methodology-tier">
          <h3>Tier 1 — Primary legal document</h3>
          <p>
            Court filings, official disciplinary findings, decertification orders — documents produced by a court or
            a governmental disciplinary body itself. The highest-confidence source category, and the only tier
            eligible (alongside Tier 2) for expedited one-click or bulk approval.
          </p>
        </div>

        <div className="methodology-tier">
          <h3>Tier 2 — Official dataset</h3>
          <p>
            Structured data published directly by a government body or an established open-records project — for
            example a state decertification registry, or an official department disciplinary dataset.
          </p>
        </div>

        <div className="methodology-tier">
          <h3>Tier 3 — Established news</h3>
          <p>
            Reporting from an established news organization. Always requires a full manual review before
            publication, regardless of how confidently it matches an existing officer record.
          </p>
        </div>

        <div className="methodology-tier">
          <h3>Tier 4 — Submitted, unverified</h3>
          <p>
            A tip or document submitted directly to us that hasn't yet been independently corroborated. This is the
            lowest-confidence tier and always requires full manual review and, where possible, corroboration against
            a higher-tier source before anything from it is published.
          </p>
        </div>
      </section>

      <section className="page-section">
        <h2>What "review" means before a record is published</h2>
        <p>
          Nothing reaches this site automatically. Every candidate record — whether pulled in by an automated source
          check or submitted by hand — lands in an internal review queue first. A human reviewer confirms:
        </p>
        <ul>
          <li>The record is matched to the correct officer (not just a similarly-named one).</li>
          <li>The source citation actually supports the specific claim being published.</li>
          <li>
            Any complainant, victim, or witness named in the source is redacted or genericized in our summary,
            unless that person is independently named as a party in the source document itself.
          </li>
          <li>A photo, if one is attached, is manually confirmed to be the correct officer before publication.</li>
        </ul>
        <p>
          Only Tier 1/Tier 2 sourced records with a high-confidence officer match are ever eligible for expedited
          approval — and even then, a reviewer can still pull any record for a closer look. Every publish, edit, and
          approval is written to a permanent, timestamped revision log, which is retained even if a record is later
          corrected or removed.
        </p>
      </section>

      <section className="page-section">
        <h2>The correction process</h2>
        <p>
          If you believe a record about you, your department, or someone you represent is inaccurate, you can file a
          correction request at any time — no account needed. Use the{" "}
          <Link to="/disputes/new">correction request form</Link>. We aim to acknowledge every request within 5
          business days.
        </p>
        <p>
          While a request is open, the record it concerns is flagged as under review rather than silently removed or
          left to stand unchanged. Once a request is resolved, the resolution and our notes on it are shown directly
          on the record's page — not just kept in an internal log — and that resolution record is kept indefinitely,
          even if the underlying record is later corrected or removed. You can check the status of a request you've
          already filed on the <Link to="/disputes/status">dispute status page</Link> using the id you were given at
          submission.
        </p>
        <p>
          Inclusion of a record on this site is never itself a finding of wrongdoing — see the disclaimer on every
          officer page for what "alleged," "sustained," "unsustained," and "exonerated" mean.
        </p>
      </section>
    </div>
  );
}
