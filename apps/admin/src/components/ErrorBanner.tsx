export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="callout callout-error" role="alert">
      {message}
    </div>
  );
}
