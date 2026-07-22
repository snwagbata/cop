/**
 * Renders an officer photo, or a neutral placeholder when photoUrl is null.
 * DESIGN.md §4/§6: photoUrl is deliberately omitted rather than guessed
 * when no verified photo exists, so the frontend must never substitute a
 * generic/stock headshot that could itself read as a real photo and create
 * a misidentification risk — a plain placeholder (initials or icon) only.
 */
export function PhotoOrPlaceholder({
  photoUrl,
  alt,
  initials,
  className = "",
}: {
  photoUrl: string | null;
  alt: string;
  initials: string;
  className?: string;
}) {
  if (photoUrl) {
    return <img className={`${className}`.trim()} src={photoUrl} alt={alt} />;
  }
  return (
    <div className={`photo-placeholder ${className}`.trim()} role="img" aria-label={`${alt} — no photo on file`}>
      {initials || "?"}
    </div>
  );
}
