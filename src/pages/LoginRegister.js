import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import AuthFrame from "../components/AuthFrame";

export default function LoginRegister({ adminOnly = false }) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [mode, setMode] = useState("login");
  const [role, setRole] = useState(adminOnly ? "admin" : search.get("role") === "freelancer" ? "freelancer" : "client");
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState(search.get("session") === "expired" ? "Session expired. Log in again." : "");
  const [success, setSuccess] = useState(search.get("account") === "updated" ? "Account security updated. All devices were signed out; log in again." : search.get("reset") === "success" ? "Password updated. Log in with your new password." : "");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError(""); setSuccess("");
    if (adminOnly && mode === "register") { setError("Admin accounts are created locally by an operator."); return; }
    if (mode === "register" && form.password !== form.confirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      if (mode === "register") {
        await api("/auth/register", { method: "POST", body: JSON.stringify({ name: form.name.trim(), email: form.email.trim(), password: form.password, role }) });
        setMode("login"); setForm({ ...form, password: "", confirm: "" });
        setSuccess("Account created. Log in to continue.");
      } else {
        const data = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: form.email.trim(), password: form.password, role }) });
        const projectId = search.get("project");
        navigate(data.user.role === "admin" ? "/admin/overview" : data.user.role === "client" ? "/client-dashboard" : projectId && /^[a-f0-9]{24}$/i.test(projectId) ? `/freelancer-dashboard?project=${projectId}` : "/freelancer-dashboard", { replace: true });
      }
    } catch (err) { setError(mode === "login" && err.message?.startsWith("Connection interrupted") ? "The connection dropped before sign-in finished. Please try logging in again." : err.message || "Unable to connect. Please try again shortly."); }
    finally { setBusy(false); }
  }

  return <AuthFrame eyebrow={adminOnly ? "PRIVATE CASE REVIEW" : "WELCOME TO FREELANCECHAIN"} title={adminOnly ? "Admin sign in" : mode === "login" ? "Welcome back" : "Create your account"} intro={adminOnly ? "Sign in to review project cases." : mode === "login" ? "Log in to continue your work." : "Choose how you’ll use your workspace."}>
    {!adminOnly && <div className="auth-tabs"><button type="button" className={mode === "login" ? "selected" : ""} onClick={() => { setMode("login"); setError(""); }}>Log in</button><button type="button" className={mode === "register" ? "selected" : ""} onClick={() => { setMode("register"); setError(""); }}>Sign up</button></div>}
    {!adminOnly && <><div className="role-label">I’m joining as</div><div className="role-choices"><button type="button" className={role === "client" ? "chosen" : ""} onClick={() => setRole("client")}><span>▣</span><strong>Client</strong><small>Hire & manage</small></button><button type="button" className={role === "freelancer" ? "chosen" : ""} onClick={() => setRole("freelancer")}><span>✦</span><strong>Freelancer</strong><small>Find & deliver</small></button></div></>}
    {!adminOnly && <p className="auth-intro">One account stays signed in across this browser. To keep another account open, use a separate browser profile or private window.</p>}
    <form onSubmit={submit} className="stack-form">
      {mode === "register" && <label>Full name<input autoComplete="name" required minLength="2" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Your name" /></label>}
      <label>Email address<input type="email" autoComplete="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" /></label>
      <label>Password<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength="8" maxLength="128" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" /></label>
      {mode === "login" && <Link className="forgot-link" to="/forgot-password">Forgot password?</Link>}
      {mode === "register" && <label>Confirm password<input type="password" autoComplete="new-password" required value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} placeholder="Repeat your password" /></label>}
      {error && <p className="message error" role="alert">{error}</p>}{success && <p className="message success" role="status">{success}</p>}
      <button className="button button-dark full" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}<span>↗</span></button>
    </form>
  </AuthFrame>;
}
