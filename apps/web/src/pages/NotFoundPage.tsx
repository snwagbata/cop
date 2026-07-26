import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div className="empty-state">
      <p>Page not found.</p>
      <p>
        <Link to="/">Back to search</Link>
      </p>
    </div>
  );
}
