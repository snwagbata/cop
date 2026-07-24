# COP — Officer Accountability Database
### Design Document v0.4

Changelog from v0.3: folded in findings from a First Amendment/defamation legal review — added the officer public-official/actual-malice doctrinal framework (and tied it explicitly to the review/revision infrastructure as the actual-malice defense), added third-party/civilian privacy protection (previously the design only protected officers), added the prior-restraint risk analysis, added the *Milkovich* reasoning behind the "no scores" rule, added *Bartnicki*/*Florida Star* reasoning to the anonymous-tip backlog item, and connected the correction process to state retraction-statute requirements. This version adds legal *reasoning*, not just legal *rules* — prior versions stated the rules; this one explains why they're the right rules, so future changes can be checked against the same doctrine rather than just the resulting checklist.

## 1. Purpose & Scope

A public-interest database that tracks law enforcement officers (by name, badge number, department) alongside documented incidents of misconduct, contradicted incident reports, sustained complaints, lawsuits, and disciplinary outcomes — sourced from public records, court filings, news coverage, and (where legally obtainable) footage links.

**This system tracks documents and metadata about incidents, not raw video hosting.** Footage links point to primary sources (court exhibits, news publications, official releases) rather than storing re-hosted copies, for the legal reasons discussed in section 3.

### Non-goals
- Not a real-time surveillance or footage-hosting platform.
- Not a place to publish unverified allegations — every published record must trace to a citable source.
- Not a vigilante tool. No home addresses, no non-professional personal information about officers.
- Not a publisher of civilian identities beyond what's independently public in the source record itself — complainants, victims, and witnesses are private figures with different (lower) legal protection thresholds than officers; see §3.
- Not a tool for bulk-harvesting a full roster for targeting purposes (see §9).
- Not a source of individual officer ratings/scores — see §3 for why department-level aggregate scorecards are a different, permitted category.

## 2. Core Use Case

A person interacting with police (or their attorney/journalist) can look up an officer by name, badge number, or department and see:
- Prior sustained misconduct findings
- Lawsuits filed/settled naming them
- Cases where a DA declined to prosecute after reviewing body cam footage
- Known "wandering officer" history (fired/resigned from one department, hired at another)
- Links to the underlying documents/articles for each entry

**Search flow, specifically**: a name/badge search that matches more than one officer never reveals any record directly. It shows a disambiguation step first — each candidate's department, badge number, and active date range (plus a verified photo where one exists) — so the person picks the right officer before any incident data is displayed. This is a product-level control, not just a backend heuristic: it's the direct mitigation for the misidentification risk §3 and §6 call the single biggest risk in the project.

A person can also browse a **department's aggregate accountability record** — total settlement payouts, sustained-complaint counts, wandering-officer hires — without any individual officer being rated (§3, §4).

## 3. Legal & Risk Framework (read before building anything else)

This section drives most of the technical design, so it comes first.

- **Defamation exposure**: Publishing "Officer X lied in a report" as a bare assertion is dangerous if wrong. Every incident record must carry a citation to a primary source (court document, official disciplinary finding, or news article) and use the source's own characterization (e.g., "DA's office declined to prosecute after body cam review" is safe; "Officer X is a liar" is not).

- **Officer public-official status and the actual-malice standard.** Police officers are, with near uniformity across jurisdictions, treated as **"public officials"** for defamation purposes when the speech concerns their official conduct (*New York Times v. Sullivan*, 376 U.S. 254 (1964); *Rosenblatt v. Baer*, 383 U.S. 75 (1966)). That means an officer-plaintiff generally cannot recover for a defamatory statement about their official conduct without proving **actual malice** — that the publisher knew the statement was false or acted with reckless disregard for its truth. This is a subjective standard about the publisher's state of mind, not "was there an error."
  - **This is why the review/revision infrastructure matters as much as it does.** A documented, systematic, source-tiered review process (`review_queue`, `record_revisions`, the reliability-tier gating in §4/§7) is close to the textbook evidence a defendant uses to *disprove* reckless disregard. Treat that infrastructure as doing legal work, not just data hygiene — it's the actual-malice defense, built as a byproduct of the normal editorial workflow.
  - **Caveat — don't over-rely on this as a blanket assumption.** The doctrine is well-settled for on-duty conduct by sworn officers, but courts have drawn lines around very low-visibility roles and non-sworn civilian department employees, who may not qualify as public officials at all. Keep sourcing discipline uniform across every row in `officers` regardless — exactly as already designed — rather than relaxing rigor for records assumed to carry the higher-standard protection.

- **Defamation by implication / juxtaposition**: A list of individually true, sourced facts can still support a defamation claim if the *arrangement* implies something false — e.g., five dismissed lawsuits displayed with equal visual weight next to one sustained finding, with no indication of outcome or base rate. Mitigation, concrete:
  - Outcome type is always rendered at least as prominently as the incident description itself (never buried below a fold or in small type).
  - Dismissed/unsustained/exonerated outcomes are never visually indistinguishable from sustained ones — different, consistently-applied badges/colors, not just text.
  - No default sort that surfaces negative-only records without also surfacing dismissals/exonerations for the same officer.
  - Officer pages include a standard disclaimer block (drafted with counsel) explaining what "alleged" vs "sustained" means and that inclusion is not itself a finding of wrongdoing.
  - This same design also mitigates **false light** invasion-of-privacy claims (Restatement (Second) of Torts §652E), a distinct tort from defamation that doesn't require a false statement — only a false *implication* highly offensive to a reasonable person. Because false light claims about public matters carry the same actual-malice standard as defamation, the juxtaposition mitigations above knock out both theories at once.

- **Third-party / civilian privacy** (new). Incident records will frequently name complainants, victims, and witnesses — and unlike officers, these individuals are almost never public officials or public figures. Two consequences:
  - **Lower fault standard.** Ordinary negligence, not actual malice, governs defamatory statements about them — the same sourcing discipline applies, but there's no *NYT v. Sullivan* cushion to fall back on if a civilian's name or role is misstated.
  - **Independent privacy-tort exposure** that officers, as public officials commenting on their own official conduct, don't carry to the same degree: *public disclosure of private facts* (Restatement §652D — true, non-newsworthy private facts, highly offensive if disclosed) and false light (above). Concrete rule: civilian names and identifying details in `incidents.short_description` are redacted/genericized by default ("the complainant," "a bystander") unless the person is independently named as a party in the source document itself (e.g., a named plaintiff in a public §1983 filing) — see §4, §7 for where this is enforced.

- **Public records law varies by state**: what departments must release (personnel files, IA findings, footage) differs enormously — CA, NY, and a few others are relatively open post-reform; many states are not. The ingestion pipeline needs a per-state ruleset, not one global assumption.

- **Footage-specific risk**: bystander/victim privacy, minors, sexual assault or medical details are often required redactions even in "open" states. Never re-host raw video Claude/you haven't verified was released through a proper legal channel.

- **Identity resolution errors are the single biggest risk**: matching the wrong "John Smith" to a misconduct record is worse than not having the record at all. See section 6, including the mandatory disambiguation UI (§2) and the identity-signal-conflict rule.

- **No self-published "scores" or "risk ratings"** on individual officers — aggregation/rating schemes read as editorializing and are harder to defend than a list of sourced, dated facts. This isn't just a conservative style choice: *Milkovich v. Lorain Journal Co.*, 497 U.S. 1 (1990), narrowed the "opinion" defense considerably — labeling something "our opinion" or "a risk score" doesn't protect it if a reasonable reader would understand it to imply undisclosed defamatory facts. A rating construct ("this officer is high-risk") reads exactly like the kind of fact-implying evaluative statement *Milkovich* stripped of opinion-defense protection, no matter how it's framed. The "facts not scores" rule is the correct read of where that defense actually stops working, not just a stylistic preference.
  - **Department-level aggregate scorecards are a different, lower-risk category** (§4's `department_stats`), because they aggregate a government entity's public financial/disciplinary record rather than rating an individual person. To keep that distinction real, not just nominal: scorecard figures must be computed *exclusively* from already-published, individually-sourced `incidents`/`outcomes` rows — the aggregation step is never allowed to introduce a claim that isn't already independently sourced and public on the underlying records. No department-level "grade" or ranking either — raw counts and dollar totals only, same "facts not scores" rule applied one level up.

- **Prior restraint risk is low; damages/litigation-cost risk is the real exposure** (new). Courts almost never enjoin publication of speech on a matter of public concern before the fact — *Near v. Minnesota*, 283 U.S. 697 (1931), makes prior restraints presumptively unconstitutional, and that doctrine holds up even against a motivated officer or department plaintiff. Practically: a court blocking this database from publishing already-reviewed records is a legally unlikely scenario. The realistic risk profile is a post-publication damages suit and the cost of defending one — even a suit you'd eventually win. This is exactly why the entity/insurance prerequisite below is the load-bearing mitigation; it's not worth over-engineering the architecture around a takedown-injunction scenario that's doctrinally disfavored, at the expense of the litigation-cost exposure that's actually likely.

- **Legal entity and insurance are a prerequisite, not a nice-to-have.** Running this as an unincorporated personal project leaves the operator personally exposed to defamation and SLAPP-style suits, which are expensive to defend even when meritless. Before Phase 1 seed data is reachable by anyone outside the reviewer:
  - Operate under an existing journalism/accountability nonprofit's fiscal sponsorship (e.g. the kind Invisible Institute, MuckRock-adjacent projects, or a local press-freedom nonprofit provides), **or** form a dedicated LLC/nonprofit for the project.
  - Carry media liability / errors-and-omissions insurance sized for a defamation defense, not just a general liability policy.
  - Identify anti-SLAPP protection in your operating state(s) — several states have strong anti-SLAPP statutes that allow early dismissal + fee-shifting, which materially changes the risk calculus of where the entity is domiciled/operates from.

- **Section 230 does not cover this project's core risk.** 230 protects platforms from liability for *third-party* content displayed as such. Because every published record here goes through human review and is presented as the org's own fact-checked statement (not "user X claims..."), the org's own editorial liability applies regardless of where the underlying tip originated. Don't rely on 230 as a defense for reviewed/published records — it may offer some protection for a clearly-labeled unmoderated tip/comment feature, if one is ever added, but that's a different, distinct feature not currently in scope. (Separately, see §12 for why lawfully-obtained leaked material is protected on different doctrinal grounds entirely — *Bartnicki*, not 230.)

Recommendation: engage a media/First Amendment attorney starting in **Phase 0** (§11) — specifically to review the display/juxtaposition design, the department-scorecard framing, the civilian-redaction default, and the entity/insurance question before any reviewed record is reachable outside the reviewer, even "unlisted."

## 4. Data Model

```
departments
  id, name, state, jurisdiction_type, contact_info, records_request_portal_url

officers
  id, first_name, last_name, known_aliases[], department_id (current),
  badge_number, rank, hire_date, employment_status,
  post_certification_id,           -- state POST/certification number; nullable but
                                    -- the primary cross-department match key (see §6)
  photo_url                        -- nullable; MUST trace to an official/verified source
                                    -- (department release, court exhibit) — never a scraped
                                    -- social-media photo. Omit rather than guess: a wrong
                                    -- photo is a misidentification risk, not a cosmetic one.
                                    -- Used by the disambiguation UI (§2, §6).

officer_department_history   -- for tracking "wandering officers"
  officer_id, department_id, start_date, end_date, separation_reason, source_id
  -- DB constraint: EXCLUDE USING gist so (department_id, badge_number) cannot have
  -- two overlapping [start_date, end_date) ranges — prevents silent badge-reuse collisions

incidents
  id, department_id, date, incident_type
    (e.g. use_of_force, false_report, unlawful_arrest, other),
  short_description (neutral, source-derived language only; civilian names/identifying
    details are redacted/genericized by default per §3's third-party privacy rule —
    "the complainant," "a bystander" — unless the person is independently named as a
    party in the source document itself, e.g. a named plaintiff in a public filing),
  status (alleged / sustained / unsustained / exonerated / pending / disputed)

incident_officers
  incident_id, officer_id, involvement_role (primary / witness / named_defendant / other)

outcomes
  id, incident_id, outcome_type
    (internal_discipline, termination, DA_declination, lawsuit_settlement,
     lawsuit_dismissed, criminal_charges_officer, no_action),
  date, amount_cents (nullable), currency (default 'USD'), details
  -- amount is intentionally simple (single currency) for a US-only launch;
  -- revisit if/when the project covers non-US jurisdictions

sources
  id, source_type (court_doc, news_article, public_records_response,
     official_dataset, decertification_registry),
  url, publication_date, retrieved_date,
  reliability_tier (tier1_primary_legal_doc / tier2_official_dataset /
     tier3_established_news / tier4_submitted_unverified)
  -- tier gates auto-approval eligibility in the review queue (§7): only
  -- tier1/tier2 sources are ever eligible for bulk/one-click approval

citations
  id, source_id, citable_type (incident / outcome / officer), citable_id
  -- lets one source document back multiple records (e.g. a single decertification
  -- list backing many officers), and lets outcomes carry their own independent
  -- citation instead of inheriting only the parent incident's source

review_queue
  id, proposed_record (json), source_id, match_confidence, status
    (pending / approved / rejected / needs_more_info), reviewer_id, reviewed_at

reviewers
  id, name, email, role (admin / reviewer), added_at, active

record_revisions
  id, record_type (officer / incident / outcome / source),
  record_id, change_type (create / update / approve / reject / dispute_resolution),
  diff (json), changed_by (reviewer_id), created_at
  -- NOTE: record_id is a polymorphic reference across four tables, deliberately.
  -- Postgres cannot enforce this with a real foreign key. This is an accepted
  -- trade-off for a single unified audit log rather than four parallel
  -- per-entity revision tables; integrity is enforced at the application layer.
  -- LEGAL NOTE (§3): this table is the primary evidentiary record for defeating
  -- an actual-malice claim under NYT v. Sullivan when an officer-plaintiff is
  -- a public official — it demonstrates a systematic, non-reckless review
  -- process. Treat schema changes here as touching a legal control, not just
  -- an engineering convenience.

disputes
  id, incident_id (nullable), outcome_id (nullable), officer_id (nullable),
  -- exactly one of incident_id/outcome_id/officer_id is set per dispute.
  requester_name, requester_role (officer / department / attorney / subject / other),
  claim, evidence_url (nullable), submitted_at,
  status (open / resolved_corrected / resolved_no_change / resolved_removed),
  resolution_notes, resolved_by (reviewer_id), resolved_at

department_stats              -- materialized view, refreshed nightly
  department_id,
  total_settlement_amount_cents, sustained_complaint_count,
  total_incident_count, wandering_officer_hire_count,
  last_computed_at
  -- Backs the department-scorecard feature (§2, §3). Deliberately a *derived*
  -- view over incidents/outcomes/officer_department_history, not a
  -- source-of-truth table.
```

Key design choices:
- **Incidents and outcomes are always source-linked** via `citations`, and nothing reaches the public-facing `officers` view without passing through `review_queue`.
- **Multi-officer incidents are modeled as a join table** (`incident_officers`), not a packed field.
- **Every published fact has a revision trail** (`record_revisions`) — which, per §3, doubles as the project's actual-malice defense — **and every dispute is a first-class record** (`disputes`) that can target an officer, incident, or outcome.
- **Department scorecards are computed, never authored** — `department_stats` has no write path other than aggregation over already-reviewed rows.
- **Civilian identity is redacted by default** in free-text fields, distinct from and in addition to the officer-focused privacy rules — see §3.

## 5. Ingestion Pipelines (by source)

Full buildable system design (compute/scheduling choice, per-source pipeline
design, schema additions, cost breakdown, rollout order) is in
[`INGESTION_DESIGN.md`](INGESTION_DESIGN.md) — built around a hard low/no-cost
constraint this project doesn't have a funding model to relax. The table
below is the original source survey; the doc is the actual plan.

| Source | Automatable? | Method | Notes |
|---|---|---|---|
| State decertification registries | Yes, high confidence | Scheduled scraper/API pull | Structured, low-noise, highest value-per-effort. Also the best source for `post_certification_id` (§4, §6) — prioritize registries that publish it. |
| Existing open datasets (LLEAD, Police Records Access Project, National Police Index) | Yes | Periodic sync job against their published exports/APIs | Don't duplicate their human effort — treat as upstream sources |
| Court dockets — **CourtListener/RECAP**, not raw PACER | Partially | API pull against CourtListener's free bulk/RECAP mirror for §1983 filings naming officers; fall back to manual PACER retrieval only for documents RECAP doesn't have | Requires NLP step to extract officer name/badge from docket text; flag low-confidence extractions. Settlement orders found this way should be attached to the relevant `outcomes` row via `citations`, not just the parent incident. |
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
→ human approves/rejects/edits in review_queue (civilian names redacted per §3/§4
   if not already genericized by the extraction step)
→ approved records promoted to public schema (writes a record_revisions row,
   plus a citations row linking the source to the specific incident/outcome/officer)
```

## 6. Identity Resolution

This is the hardest technical problem and the one most worth over-investing in.

- **Primary cross-department key: `post_certification_id`.** Badge numbers are department-local and reset/reuse across departments and over time, so name+badge alone is too weak for the "wandering officer" use case in §2. Where a source provides it, it's the authoritative match key.
- **Secondary key within a department:** `(normalized_name, department_id, badge_number)`, paired with employment date ranges — enforced at the DB level via an exclusion constraint on `officer_department_history` (§4).
- **Fuzzy name matching** (e.g., Jaro-Winkler, Postgres `pg_trgm`) for name variants/typos across sources, always surfaced as a *suggestion*, never auto-merged.
- **Conflict rule**: whenever the primary signal (`post_certification_id`) and the secondary signal (`normalized_name`/`badge_number`) disagree, the record is forced to `match_confidence=low` and routed to manual review *regardless of source reliability tier*.
- Every new source record either matches an existing officer or creates a **candidate** new officer entry — never silently created without review.
- Maintain an audit log of every merge/match decision (`record_revisions`, record_type='officer') for accountability of the accountability database itself.
- **Mandatory disambiguation UI (§2)**: any public search matching more than one `officer` row must render a picker (department, badge number, active date range, verified photo if present) before any incident/outcome data for any candidate is shown. This applies identically to the internal review-queue UI.

## 7. Review Workflow ("minimal effort" without removing the human check)

Given the goal of low ongoing effort, the review queue is designed to make human review fast, not to remove it:

- Weekly digest: "12 new candidate records this week, 9 auto-matched with high confidence, 3 need your input."
- One-click approve **only for tier1/tier2-sourced, high-confidence-match records** (§4's `reliability_tier` gate, and never when the §6 conflict rule has fired) — tier3/tier4 sources always require a real look regardless of match confidence.
- Bulk-approve for a whole batch from a single trusted tier1/tier2 source (e.g., an official decertification list) after spot-checking a sample.
- **`photo_url` is never auto-approved**, even from a tier1 source — a reviewer must positively confirm the photo matches the officer being published.
- **Civilian-redaction check**: reviewer confirms any complainant/victim/witness names or identifying details in `short_description` are redacted or genericized, unless the person is independently named as a party in the source document itself. This is a one-click gate, not a rewrite step, for the common case — most extraction pipelines should already genericize by default (§5).
- Every approval, rejection, and edit writes a `record_revisions` row automatically — which, per §3, is also the project's primary actual-malice defense evidence.
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
                 │   Web frontend        │  (officer pages w/ mandatory
                 │                       │   disambiguation, department
                 │                       │   scorecard pages)
                 └─────────────────────┘
```

**Suggested stack:**
- Postgres for the relational core (`pg_trgm` for fuzzy match, `btree_gist` for the exclusion constraint in §4/§6, a nightly `REFRESH MATERIALIZED VIEW` job for `department_stats`).
- **Internal/public separation enforced at the database layer, not just application logic**: separate Postgres schemas (`internal` vs `public`) with distinct DB roles and row-level security policies.
- Python (or Node) for ingestion workers — cron or a lightweight scheduler (e.g., APScheduler, or GitHub Actions on a cron trigger for low-volume jobs).
- A minimal internal admin tool for the review queue, backed by the `reviewers` table for per-action attribution, including the photo-confirmation and civilian-redaction checks (§7).
- Public read-only API (REST or GraphQL) with rate limiting and anti-bulk-harvesting controls — see §9.
- Static or lightweight frontend (search-with-disambiguation by name/badge/department, plus department scorecard pages) — no need for anything heavy at first.

## 9. Security & Privacy

- Public API should **not** expose officer home addresses, personal phone numbers, family information, or anything beyond professional/employment-relevant data. Photos (§4) are limited to officially-sourced professional photos only — never scraped from personal/social accounts.
- **Civilian third parties get the same non-exposure floor as officers, plus more**: officers' professional/employment data is the intended subject of this database; civilians named in an incident are not, and are redacted by default per §3/§4/§7. This is a stricter default, not a parallel one.
- Rate-limit and log public API access; require registration for bulk/API access to deter misuse while keeping basic single-lookup search open.
- **Bulk-harvesting / targeting misuse mitigation**:
  - Anomaly monitoring on query patterns (e.g. sequential badge-number sweeps, high-velocity distinct-officer lookups) independent of per-key limits.
  - ToS explicitly prohibiting bulk redistribution or use for targeting/harassment, with a process to revoke API access on violation.
  - No bulk "list all officers in department X" endpoint on the public API — single-officer lookup only, unless a registered research/journalism use case is separately vetted. (Department *scorecards* are exempt since they expose only aggregate counts/totals, never a roster.)
- Keep an internal-only `review_queue` schema, enforced by DB roles/RLS (§8).
- Version-control every published record's edit history (`record_revisions`, §4) for transparency, correction requests, and the actual-malice defense described in §3.

## 10. Correction & Takedown Process

Any credible accountability database needs a visible process for officers (or departments) to dispute a record, backed by the `disputes` table (§4), which can target an officer record directly (wrong badge/department/photo) as well as a specific incident or outcome:
- A documented dispute/correction request form, writing a `disputes` row.
- Disputed records get a visible "under review" flag (`incidents.status = 'disputed'`, or an analogous flag on the officer/outcome page) rather than silent removal or silent standing.
- A stated SLA for first response (e.g. acknowledge within 5 business days).
- A designated contact/agent for legal correspondence, published on the site.
- Resolution and resolution notes are retained on the `disputes` row indefinitely for the org's own legal protection, even after a record is corrected or removed.
- **Retraction-statute alignment (new).** Many states (e.g. California Civil Code §48a) require a plaintiff to make a proper correction/retraction demand before certain damages — often punitive or presumed damages — become available, and a publisher who corrects promptly and prominently upon such a demand gets meaningful statutory damages protection in return. The workflow above already has the structural pieces (a tracked dispute, an SLA, a resolution record); what's still open is confirming the *specific* procedural requirements of your operating state's statute — timing window, required prominence of the correction relative to the original record — and encoding any hard requirement directly into this process rather than leaving it as generic good practice. Flagged as counsel work for Phase 0 (§3, §13), not an engineering task.

## 11. Rollout Plan

1. **Phase 0**: Resolve entity/insurance question (§3) and engage a First Amendment attorney to review the display/juxtaposition design, the department-scorecard framing, the civilian-redaction default, and retraction-statute alignment (§10) — before any reviewed record is reachable outside the reviewer, including "unlisted."
2. **Phase 1**: Schema (including `citations`, `disputes.officer_id`, civilian-redaction defaults, and the mandatory disambiguation UI — these ship with the first frontend, not retrofitted later) + manual seed data for one state/department, sourced from an existing open dataset (e.g., LLEAD or Police Records Access Project).
3. **Phase 2**: Add 1–2 automatable pipelines (decertification registry + one news monitor) with the review queue. Turn on `department_stats`/scorecards once at least one department has enough ingested, reviewed data for the aggregate numbers to be meaningful.
4. **Phase 3**: Add court docket monitoring (CourtListener/RECAP) and MuckRock-based FOIA automation.
5. **Phase 4**: Crowdsourced footage-link submission with verification workflow.
6. **Phase 5**: Public API + frontend hardening, public launch.
7. **Phase 6+**: Backlog features (§12), prioritized post-launch based on actual user feedback.

## 12. Backlog: Additional Brainstormed Features

Not folded into the core schema/rollout above because each is either lower-leverage than the two selected in v0.3, or genuinely independent product work that doesn't gate the core data model.

**For people who just interacted with police / their families:**
- Printable, citation-backed one-page summary per officer — for handing to a legal-aid intake appointment.
- Right-of-reply excerpt shown inline on the record page (not just logged in `disputes.resolution_notes`) — near-free to build since the data already exists in `disputes`; mostly a frontend decision.
- Multi-language support, starting with Spanish.

**For attorneys / journalists / researchers:**
- Follow/saved-search with email digest ("notify me when a new sourced record is added for Officer X or Department Y").
- Citation-ready export (legal/journalistic citation format) per officer or incident.
- Vetted bulk/API export for registered research use cases.

**Trust infrastructure:**
- Public FOIA-tracker page per department.
- Public methodology/sourcing-standards page explaining the tier system and review process — doubles as a legal-defense artifact demonstrating systematic diligence, alongside `record_revisions` (§3, §4).
- **Anonymous, source-protected tip intake** (no IP logging by default) for the footage/tip submission form (§5). Legal grounding, not just a privacy nicety: *Bartnicki v. Vopper*, 532 U.S. 514 (2001), and *Florida Star v. B.J.F.*, 491 U.S. 524 (1989), together establish that the First Amendment strongly protects publication of truthful information lawfully obtained about a matter of public concern, even where the *source's* original disclosure to you may itself have violated a policy or law — so long as the org didn't participate in or induce the unlawful acquisition. That doctrine is a meaningful tailwind for this feature specifically. **Limit**: it protects publication of *true* information; it says nothing about accuracy. A leaked document that's misdated, out of context, or misattributed is squarely the identity-resolution/accuracy risk §6 already treats as the top concern, and this doctrine doesn't touch that risk at all.
- Accessibility (WCAG-compliant, low-bandwidth-friendly) — treat as a launch-blocking bar for Phase 5, not a backlog nice-to-have.

## 13. Open Questions to Resolve Before Building

- Which state(s)/department(s) are you starting with?
- Who is "the reviewer" — just you, or do you want a small trusted group?
- Do you want this fully public from day one, or usable-but-unlisted while you validate data quality? (Note: per §3, "unlisted but live" is still legally publication.)
- What legal entity will operate this — fiscal sponsorship under an existing nonprofit, or a new LLC/nonprofit? Who is the named point of contact for correction requests and legal correspondence (§10)?
- Does your target state's decertification registry publish POST/certification numbers?
- Do target departments publish official officer photos anywhere reviewable (press releases, court exhibits)? If not, `photo_url` and the photo-based disambiguation aid may need to stay empty for most officers at launch.
- **New**: Does your operating state have a retraction statute (§10), and if so, what are its specific timing/prominence requirements? Needs a direct answer from counsel, not an assumption.
- **New**: Is there a risk that the civilian-redaction default (§3, §4) undercuts a specific use case you care about — e.g., a journalist wanting a named complainant's identity preserved because it's central to a story already public elsewhere? If so, the "independently named as a party in the source document" exception (§4) is the intended release valve; worth confirming it's not too narrow in practice once real records start flowing through Phase 1.
