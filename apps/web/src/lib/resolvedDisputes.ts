import type { ResolvedDisputeSummary } from "@cop/shared-types";

/**
 * Right-of-reply lookup (DESIGN.md §12): finds resolved disputes that target
 * a specific incident/outcome/officer record, so they can be rendered
 * inline on that exact section of the officer page rather than only logged
 * internally. Matching is by (targetType, targetId) exactly as the API
 * contract in shared-types documents.
 */
export function findResolvedDisputes(
  resolvedDisputes: ResolvedDisputeSummary[],
  targetType: ResolvedDisputeSummary["targetType"],
  targetId: string,
): ResolvedDisputeSummary[] {
  return resolvedDisputes.filter((d) => d.targetType === targetType && d.targetId === targetId);
}
