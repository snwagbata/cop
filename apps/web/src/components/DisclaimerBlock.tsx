/**
 * Renders the disclaimer copy exactly as returned by the API
 * (OfficerDetail.disclaimer). DESIGN.md §3 requires standard, counsel-drafted
 * disclaimer copy — never rewritten per-page — so this component only ever
 * displays the string it's given, verbatim, and places it prominently near
 * the top of the officer page rather than in a footer.
 */
export function DisclaimerBlock({ text }: { text: string }) {
  return (
    <div className="disclaimer" role="note">
      <span className="disclaimer__label">About this page</span>
      {text}
    </div>
  );
}
