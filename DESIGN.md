# COP — Officer Accountability Database
### Design Document v0.2

Changelog from v0.1: fixed schema bugs (multi-officer incidents, missing revision/dispute/reviewer tables), added POST certification ID as the primary cross-department identity key, added a defamation-by-implication risk section, added legal entity/insurance as a prerequisite, swapped PACER for CourtListener/RECAP, added DB-level enforcement of the internal/public split, and added a bulk-scraping/targeting misuse mitigation. Second-pass review is a separate document (see review notes at bottom of repo history / chat).

## 1. Purpose & Scope

A public-interest database that tracks law enforcement officers (by name, badge number, department) alongside documented incidents of misconduct, contradicted incident reports, sustained complaints, lawsuits, and disciplinary outcomes — sourced from public records, court filings, news coverage, and (where legally obtainable) footage links.

**This system tracks documents and metadata about incidents, not raw video hosting.** Footage links point to primary sources (court exhibits, news publications, official releases) rather than storing re-hosted copies, for the legal reasons discussed in section 3.

### Non-goals
- Not a real-time surveillance or footage-hosting platform.
- Not a place to publish unverified allegations — every published record must trace to a citable source.
- Not a vigilante tool. No home addresses, no non-professional personal information about officers.
- Not a tool for bulk-harvesting a full roster for targeting purposes (see §9).

## 2. Core Use Case

A person interacting with police (or their attorney/journalist) can look up an officer by name, badge number, or department and see:
- Prior sustained misconduct findings
- Lawsuits filed/settled naming them
- Cases where a DA declined to prosecute after reviewing body cam footage
- Known "wandering officer" history (fired/resigned from one department, hired at another)
- Links to the underlying documents/articles for each entry

## 3. Legal & Risk Framework (read before building anything else)

This section drives most of the technical design, so it comes first.

- **Defamation exposure**: Publishing "Officer X lied in a report" as a bare assertion is dangerous if wrong. Every incident record must carry a citation to a primary source (court document, official disciplinary finding, or news article) and use the source's own characterization (e.g., "DA's office declined to prosecute after body cam review" is safe; "Officer X is a liar" is not).
- **Defamation by implication / juxtaposition**: A list of individually true, sourced facts can still support a defamation claim if the *arrangement* implies something false — e.g., five dismissed lawsuits displayed with equal visual weight next to one sustained finding, with no indication of outcome or base rate. Mitigation, concrete:
  - Outcome type is always rendered at least as prominently as the incident description itself (never buried below a fold or in small type).
  - Dismissed/unsustained/exonerated outcomes are never visually indistinguishable from sustained ones — different, consistently-applied badges/colors, not just text.
  - No default sort that surfaces negative-only records without also surfacing dismissals/exonerations for the same officer.
  - Officer pages include a standard disclaimer block (drafted with counsel) explaining what "alleged" vs "sustained" means and that inclusion is not itself a finding of wrongdoing.
- **Public records law varies by state**: what departments must release (personnel files, IA findings, footage) differs enormously — CA, NY, and a few others are relatively open post-reform; many states are not. The ingestion pipeline needs a per-state ruleset, not one global assumption.
- **Footage-specific risk**: bystander/victim privacy, minors, sexual assault or medical details are often required redactions even in "open" states. Never re-host raw video Claude/you haven't verified was released through a proper legal channel.
- **Identity resolution errors are the single biggest risk**: matching the wrong "John Smith" to a misconduct record is worse than not having the record at all. See section 6.
- **No self-published "scores" or "risk ratings"** on individual officers — aggregation/rating schemes read as editorializing and are harder to defend than a list of sourced, dated facts. (Department-level *aggregate* stats, e.g. total settlement payouts, are a different and lower-risk category — see the brainstorm section.)
- **Legal entity and insurance are a prerequisite, not a nice-to-have.** Running this as an unincorporated personal project leaves the operator personally exposed to defamation and SLAPP-style suits, which are expensive to defend even when meritless. Before Phase 1 seed data is reachable by anyone outside the reviewer:
  - Operate under an existing journalism/accountability nonprofit's fiscal sponsorship (e.g. the kind Invisible Institute, MuckRock-adjacent projects, or a local press-freedom nonprofit provides), **or** form a dedicated LLC/nonprofit for the project.
  - Carry media liability / errors-and-omissions insurance sized for a defamation defense, not just a general liability policy.
  - Identify anti-SLAPP protection in your operating state(s) — several states have strong anti-SLAPP statutes that allow early dismissal + fee-shifting, which materially changes the risk calculus of where the entity is domiciled/operates from.
- **Section 230 does not cover this project's core risk.** 230 protects platforms from liability for *third-party* content displayed as such. Because every published record here goes through human review and is presented as the org's own fact-checked statement (not "user X claims..."), the org's own editorial liability applies regardless of where the underlying tip originated. Don't rely on 230 as a defense for reviewed/published records — it may offer some protection for a clearly-labeled unmoderated tip/comment feature, if one is ever added, but that's a different, distinct feature not currently in scope.

Recommendation: engage a media/First Amendment attorney starting in Phase 1 (not deferred to launch) — specifically to review the display/juxtaposition design and the entity/insurance question before any reviewed record is reachable outside the reviewer, even "unlisted."

## 4. Data Model

```
departments
  id, name, state, jurisdiction_type, contact_info, records_request_portal_url

officers
  id, first_name, last_name, known_aliases[], department_id (current),
  badge_number, rank, hire_date, employment_status,
  post_certification_id            -- state POST/certification number; nullable but
                                    -- the primary cross-department match key (see §6)

officer_department_history   -- for tracking "wandering officers"
  officer_id, department_id, start_date, end_date, separation_reason, source_id
  -- DB constraint: EXCLUDE USING gist so (department_id, badge_number) cannot have
  -- two overlapping [start_date, end_date) ranges — prevents silent badge-reuse collisions

incidents
  id, department_id, date, incident_type
    (e.g. use_of_force, false_report, unlawful_arrest, other),
  short_description (neutral, source-derived language only),
  status (alleged / sustained / unsustained / exonerated / pending / disputed)

incident_officers            -- NEW: fixes the v0.1 "officer_id(s)" scalar-that-was-really-plural bug
  incident_id, officer_id, involvement_role (primary / witness / named_defendant / other)

outcomes
  id, incident_id, outcome_type
    (internal_discipline, termination, DA_declination, lawsuit_settlement,
     lawsuit_dismissed, criminal_charges_officer, no_action),
  date, amount_cents (nullable), currency (default 'USD'), details
  -- amount is intentionally simple (single currency) for a US-only launch;
  -- revisit if/when the project covers non-US jurisdictions

sources
  id, incident_id, source_type (court_doc, news_article, public_records_response,
     official_dataset, decertification_registry),
  url, publication_date, retrieved_date,
  reliability_tier (tier1_primary_legal_doc / tier2_official_dataset /
     tier3_established_news / tier4_submitted_unverified)
  -- tier gates auto-approval eligibility in the review queue (§7): only
  -- tier1/tier2 sources are ever eligible for bulk/one-click approval

review_queue
  id, proposed_record (json), source_id, match_confidence, status
    (pending / approved / rejected / needs_more_info), reviewer_id, reviewed_at

reviewers                    -- NEW: was implicit, now explicit for audit-log integrity
  id, name, email, role (admin / reviewer), added_at, active

record_revisions              -- NEW: backs the "version-control every published record" requirement in §9,
                               -- which v0.1 stated in prose but never modeled
  id, record_type (officer / incident / outcome / source),
  record_id, change_type (create / update / approve / reject / dispute_resolution),
  diff (json), changed_by (reviewer_id), created_at

disputes                      -- NEW: backs the correction/takedown process in §10,
                               -- which v0.1 stated in prose but never modeled
  id, incident_id (nullable), outcome_id (nullable),
  requester_name, requester_role (officer / department / attorney / subject / other),
  claim, evidence_url (nullable), submitted_at,
  status (open / resolved_corrected / resolved_no_change / resolved_removed),
  resolution_notes, resolved_by (reviewer_id), resolved_at
```

Key design choices:
- **Incidents and outcomes are always source-linked**, and nothing reaches the public-facing `officers` view without passing through `review_queue`.
- **Multi-officer incidents are modeled as a join table** (`incident_officers`), not a packed field — required for correct entity-matching and "wandering officer" queries when an incident involves more than one officer.
- **Every published fact has a revision trail** (`record_revisions`) and **every dispute is a first-class record** (`disputes`), not just a status flag — both are the paper trail the legal framework in §3 depends on.

## 5. Ingestion Pipelines (by source)

| Source | Automatable? | Method | Notes |
|---|---|---|---|
| State decertification registries | Yes, high confidence | Scheduled scraper/API pull | Structured, low-noise, highest value-per-effort. Also the best source for `post_certification_id` (§4, §6) — prioritize registries that publish it. |
| Existing open datasets (LLEAD, Police Records Access Project, National Police Index) | Yes | Periodic sync job against their published exports/APIs | Don't duplicate their human effort — treat as upstream sources |
| Court dockets — **CourtListener/RECAP**, not raw PACER | Partially | API pull against CourtListener's free bulk/RECAP mirror for §1983 filings naming officers; fall back to manual PACER retrieval only for documents RECAP doesn't have | Requires NLP step to extract officer name/badge from docket text; flag low-confidence extractions. Raw PACER scraping is both costly (per-page fees) and awkward under its ToS for bulk automated pulls — CourtListener is the standard free, bulk-friendly alternative used by comparable projects. |
| News monitoring | Partially | RSS/News API + keyword filters ("body camera," "sustained complaint," "internal affairs," dept name) | LLM-assisted extraction of officer/incident details, always routed to review queue |
| FOIA/public records requests | Manual-assisted | MuckRock API to file & track boilerplate requests on a schedule | Filing can be automated; fulfillment and doc processing cannot |
| Body cam footage releases | Manual/crowdsourced | Submission form + verification step | No feed exists to poll; must be human-verified before linking |
| Internal affairs findings (PDFs) | Manual-heavy | OCR + human tagging | Format varies wildly by department |

**Pipeline shape (for automatable sources):**
```
scheduled job → fetch → normalize → entity match against officers table
   → if high-confidence match: land in review_queue (status=pending)
   → if no/low-confidence match: land in review_queue with match_confidence=low
       and candidate officer suggestions
→ human approves/rejects/edits in review_queue
→ approved records promoted to public schema (writes a record_revisions row)
```

## 6. Identity Resolution

This is the hardest technical problem and the one most worth over-investing in.

- **Primary cross-department key: `post_certification_id`.** Badge numbers are department-local and reset/reuse across departments and over time, so name+badge alone is too weak for the "wandering officer" use case in §2 — the entire point of that feature is matching the *same* person across different departments' local numbering. Most state decertification registries and comparable projects (e.g. Bowling Green's National Decertification Index lineage) key off the state POST/certification number for exactly this reason. Where a source provides it, it's the authoritative match key.
- **Secondary key within a department:** `(normalized_name, department_id, badge_number)`, paired with employment date ranges — enforced at the DB level via an exclusion constraint on `officer_department_history` (§4) so overlapping badge assignments can't silently collide.
- **Fuzzy name matching** (e.g., Jaro-Winkler, Postgres `pg_trgm`) for name variants/typos across sources, always surfaced as a *suggestion*, never auto-merged.
- Every new source record either matches an existing officer or creates a **candidate** new officer entry — never silently created without review.
- Maintain an audit log of every merge/match decision (`record_revisions`, record_type='officer') for accountability of the accountability database itself.

## 7. Review Workflow ("minimal effort" without removing the human check)

Given the goal of low ongoing effort, the review queue is designed to make human review fast, not to remove it:

- Weekly digest: "12 new candidate records this week, 9 auto-matched with high confidence, 3 need your input."
- One-click approve **only for tier1/tier2-sourced, high-confidence-match records** (§4's `reliability_tier` gate) — tier3/tier4 sources always require a real look regardless of match confidence.
- Bulk-approve for a whole batch from a single trusted tier1/tier2 source (e.g., an official decertification list) after spot-checking a sample.
- Every approval, rejection, and edit writes a `record_revisions` row automatically — the audit trail is a side effect of the normal workflow, not an extra step reviewers have to remember.
- This is the one place to push back on "zero effort": an unreviewed defamatory record is the main liability in this whole project, so some recurring (even 15 min/week) human-in-the-loop step is worth keeping.

## 8. Technical Architecture

```
                 ┌─────────────────────┐
                 │   Ingestion Workers   │  (scheduled jobs, one per source)
                 └──────────┬───────────┘
                            ▼
                 ┌─────────────────────┐
                 │   Normalization &     │
                 │   Entity Matching     │
                 └──────────┬───────────┘
                            ▼
                 ┌─────────────────────┐
                 │    Review Queue       │◄── human reviewer UI
                 └──────────┬───────────┘
                            ▼ (approved only)
                 ┌─────────────────────┐
                 │   Public Database     │  (Postgres)
                 └──────────┬───────────┘
                            ▼
                 ┌─────────────────────┐
                 │   API (read-only)     │
                 └──────────┬───────────┘
                            ▼
                 ┌─────────────────────┐
                 │   Web frontend        │  (search/lookup UI)
                 └─────────────────────┘
```

**Suggested stack:**
- Postgres for the relational core (`pg_trgm` for fuzzy match, `btree_gist` for the exclusion constraint in §4/§6).
- **Internal/public separation enforced at the database layer, not just application logic**: separate Postgres schemas (`internal` vs `public`) with distinct DB roles and row-level security policies, so an application bug can't accidentally expose `review_queue` or rejected candidates through the public API. The app-layer table separation described in v0.1 is necessary but not sufficient on its own.
- Python (or Node) for ingestion workers — cron or a lightweight scheduler (e.g., APScheduler, or GitHub Actions on a cron trigger for low-volume jobs).
- A minimal internal admin tool for the review queue (could start as a simple authenticated web form), backed by the `reviewers` table (§4) for per-action attribution.
- Public read-only API (REST or GraphQL) with rate limiting and anti-bulk-harvesting controls — see §9.
- Static or lightweight frontend (search by name/badge/department) — no need for anything heavy at first.

## 9. Security & Privacy

- Public API should **not** expose officer home addresses, personal phone numbers, family information, or anything beyond professional/employment-relevant data.
- Rate-limit and log public API access; require registration for bulk/API access to deter misuse while keeping basic single-lookup search open.
- **Bulk-harvesting / targeting misuse mitigation** (new — v0.1's per-key rate limit alone doesn't stop coordinated scraping across many accounts/IPs to reconstruct a full roster for targeting, which is in tension with the "not a vigilante tool" non-goal): 
  - Anomaly monitoring on query patterns (e.g. sequential badge-number sweeps, high-velocity distinct-officer lookups) independent of per-key limits.
  - ToS explicitly prohibiting bulk redistribution or use for targeting/harassment, with a process to revoke API access on violation.
  - No bulk "list all officers in department X" endpoint on the public API even though it exists internally — single-officer lookup only, unless a registered research/journalism use case is separately vetted.
- Keep an internal-only `review_queue` schema, enforced by DB roles/RLS (§8), so unreviewed/rejected claims are never accidentally exposed.
- Version-control every published record's edit history (`record_revisions`, §4) for transparency and correction requests.

## 10. Correction & Takedown Process

Any credible accountability database needs a visible process for officers (or departments) to dispute a record, now backed by the `disputes` table (§4):
- A documented dispute/correction request form, writing a `disputes` row.
- Disputed records get a visible "under review" flag (`incidents.status = 'disputed'`) rather than silent removal or silent standing.
- A stated SLA for first response (e.g. acknowledge within 5 business days) — reduces liability and matches what courts/state AGs expect from a credible corrections process.
- A designated contact/agent for legal correspondence, published on the site.
- Resolution and resolution notes are retained on the `disputes` row indefinitely for the org's own legal protection, even after a record is corrected or removed.

## 11. Rollout Plan

1. **Phase 0 (new)**: Resolve entity/insurance question (§3) and engage a First Amendment attorney to review the display/juxtaposition design — before any reviewed record is reachable outside the reviewer, including "unlisted."
2. **Phase 1**: Schema + manual seed data for one state/department, sourced from an existing open dataset (e.g., sync from LLEAD or Police Records Access Project) to validate the model without building scrapers yet.
3. **Phase 2**: Add 1–2 automatable pipelines (decertification registry + one news monitor) with the review queue.
4. **Phase 3**: Add court docket monitoring (CourtListener/RECAP) and MuckRock-based FOIA automation.
5. **Phase 4**: Crowdsourced footage-link submission with verification workflow.
6. **Phase 5**: Public API + frontend hardening, public launch.

## 12. Open Questions to Resolve Before Building

- Which state(s)/department(s) are you starting with? (Determines which records laws and which existing datasets to sync from first.)
- Who is "the reviewer" — just you, or do you want a small trusted group?
- Do you want this fully public from day one, or usable-but-unlisted while you validate data quality? (Note: per §3, "unlisted but live" is still legally publication — the entity/insurance question in Phase 0 applies either way.)
- **New**: What legal entity will operate this — fiscal sponsorship under an existing nonprofit, or a new LLC/nonprofit? Who is the named point of contact for correction requests and legal correspondence (§10)?
- **New**: Does your target state's decertification registry publish POST/certification numbers? (Determines how strong day-one cross-department matching can be — see §6.)
