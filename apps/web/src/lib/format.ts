/** Formatting helpers shared across pages/components. */

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Format integer cents (see DESIGN.md §4 `amount_cents`) as USD currency. */
export function formatCentsAsCurrency(cents: number, currency = "USD"): string {
  if (currency !== "USD") {
    // Simple MVP fallback for a non-USD currency; §4 notes single-currency
    // is an intentional simplification for the US-only launch.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
  return currencyFormatter.format(cents / 100);
}

export function formatDate(iso: string | null): string {
  if (!iso) return "unknown date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function formatDateRange(start: string, end: string | null): string {
  return `${formatDate(start)} – ${end ? formatDate(end) : "present"}`;
}

const LABELS: Record<string, string> = {
  // incident types
  use_of_force: "Use of Force",
  false_report: "False Report",
  unlawful_arrest: "Unlawful Arrest",
  other: "Other",
  // incident status
  alleged: "Alleged",
  sustained: "Sustained",
  unsustained: "Unsustained",
  exonerated: "Exonerated",
  pending: "Pending",
  disputed: "Disputed",
  // outcome types
  internal_discipline: "Internal Discipline",
  termination: "Termination",
  DA_declination: "DA Declined to Prosecute",
  lawsuit_settlement: "Lawsuit Settlement",
  lawsuit_dismissed: "Lawsuit Dismissed",
  criminal_charges_officer: "Criminal Charges Filed",
  no_action: "No Action Taken",
  // employment status
  active: "Active",
  inactive: "Inactive",
  terminated: "Terminated",
  resigned: "Resigned",
  retired: "Retired",
  decertified: "Decertified",
  // source type
  court_doc: "Court Document",
  news_article: "News Article",
  public_records_response: "Public Records Response",
  official_dataset: "Official Dataset",
  decertification_registry: "Decertification Registry",
  // reliability tier
  tier1_primary_legal_doc: "Tier 1 — Primary Legal Document",
  tier2_official_dataset: "Tier 2 — Official Dataset",
  tier3_established_news: "Tier 3 — Established News",
  tier4_submitted_unverified: "Tier 4 — Submitted, Unverified",
  // involvement role
  primary: "Primary",
  witness: "Witness",
  named_defendant: "Named Defendant",
};

export function label(key: string): string {
  return LABELS[key] ?? key;
}
