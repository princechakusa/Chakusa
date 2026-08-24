import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../api";
import { useAuth } from "../auth";

export default function LoginPage() {
  const auth = useAuth(); const navigate = useNavigate(); const location = useLocation();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [submitting, setSubmitting] = useState(false);
  useEffect(() => { if (auth.status === "authenticated") navigate("/", { replace: true }); }, [auth.status, navigate]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setSubmitting(true);
    try { await auth.login(email, password); const from = (location.state as { from?: string } | null)?.from; navigate(from && from !== "/login" ? from : "/", { replace: true }); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "Unable to reach the administration service"); }
    finally { setSubmitting(false); }
  }
  return <div className="login-shell"><section className="login-panel"><div className="login-card"><div className="brand"><div className="brand-mark"><span /></div><div><strong>CHAKUSA</strong><small>Administration</small></div></div><div className="lock-mark"><LockKeyhole size={22} /></div><p className="eyebrow">Chakusa team only</p><h1>Sign in to Administration</h1><p>Use your approved platform administrator account.</p><form className="login-form" onSubmit={submit}><label><span>Work email</span><input autoFocus autoComplete="username" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@chakusa.com" required /></label><label><span>Password</span><input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required /></label>{error && <div className="login-error" role="alert">{error}</div>}<button className="button primary" disabled={submitting}>{submitting ? "Securing session..." : <>Continue securely <ArrowRight size={17} /></>}</button></form><div className="login-meta"><ShieldCheck size={15} /><span>Access is logged and monitored.</span></div></div></section><section className="login-visual"><div className="login-visual-copy"><p>Internal administration</p><h2>Operate the platform with clarity and control.</h2><span>Scoped sessions · Role-based access · Immutable audit trail</span></div></section></div>;
}
