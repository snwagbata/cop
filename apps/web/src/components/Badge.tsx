import type { ReactNode } from "react";
import type { BadgeCategory } from "../lib/badges";

/**
 * The single badge component used everywhere a status/outcome-type label is
 * shown (incident status, outcome type). DESIGN.md §3 requires the
 * sustained/dismissed/neutral distinction to be carried by a *consistent*
 * badge/color system, not text alone or one-off styling — so every caller
 * routes through this component rather than styling its own label.
 */
export function Badge({ category, children }: { category: BadgeCategory; children: ReactNode }) {
  return <span className={`badge badge--${category}`}>{children}</span>;
}
