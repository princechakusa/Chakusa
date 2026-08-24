import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return <div className="not-found"><span>404</span><h1>Page not found</h1><p>This administration view does not exist or is not available to your role.</p><Link className="button primary" to="/">Return to overview</Link></div>;
}
