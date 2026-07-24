import { useState } from "react";
import type { Source } from "@cop/shared-types";
import { formatDate, label } from "../lib/format";

/** Plain-text citation format used by the "copy citation" button below. */
function formatCitationText(source: Source): string {
  const parts = [label(source.reliabilityTier), label(source.sourceType)];
  if (source.url) parts.push(source.url);
  if (source.publicationDate) parts.push(`published ${formatDate(source.publicationDate)}`);
  return parts.join(" · ");
}

function CopyCitationButton({ source }: { source: Source }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(formatCitationText(source));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (e.g. insecure context); fail
      // silently rather than throwing — this is a convenience nicety, not
      // load-bearing functionality.
    }
  }

  return (
    <button
      type="button"
      className="copy-citation-btn"
      onClick={handleCopy}
      aria-label={`Copy citation: ${formatCitationText(source)}`}
    >
      {copied ? "Copied" : "Copy citation"}
    </button>
  );
}

/**
 * Renders the sourcing for an incident or outcome. DESIGN.md §3/§4: this is
 * a sourced-facts database, so every incident/outcome must show its
 * citations (source type, reliability tier, link) on the page itself — an
 * entry with no visible citation defeats the point of the project. When the
 * API sends none, that absence is shown explicitly rather than silently
 * omitting the section.
 */
export function CitationList({ citations }: { citations: Source[] }) {
  if (citations.length === 0) {
    return <p className="no-citations">No source citation on file for this record.</p>;
  }
  return (
    <ul className="citation-list">
      {citations.map((source) => (
        <li className="citation" key={source.id}>
          <span className="citation__tier">{label(source.reliabilityTier)}</span>
          {" · "}
          {label(source.sourceType)}
          {" · "}
          {source.url ? (
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              view source
            </a>
          ) : (
            <span className="citation__no-link">no external link (text-only submission)</span>
          )}
          {source.publicationDate && <> · published {formatDate(source.publicationDate)}</>}
          <CopyCitationButton source={source} />
        </li>
      ))}
    </ul>
  );
}
