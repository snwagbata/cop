import type { Source } from "@cop/shared-types";
import { formatDate, label } from "../lib/format";

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
          <a href={source.url} target="_blank" rel="noopener noreferrer">
            view source
          </a>
          {source.publicationDate && <> · published {formatDate(source.publicationDate)}</>}
        </li>
      ))}
    </ul>
  );
}
