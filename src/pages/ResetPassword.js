import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import AuthFrame from "../components/AuthFrame";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const token = search.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      await api("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) });
      navigate("/login?reset=success", { replace: true });
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <AuthFrame eyebrow="ACCOUNT RECOVERY" title="Choose a new password" intro="Your reset link works once and expires after 15 minutes.">
    {!token ? <div className="stack-form"><p className="message error" role="alert">This reset link is missing or invalid.</p><Link className="button button-dark full" to="/forgot-password">Request a new link ↗</Link></div> :
      <form className="stack-form" onSubmit={submit}>
        <label>New password<input type="password" autoComplete="new-password" required minLength="8" maxLength="128" value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 8 characters" /></label>
        <label>Confirm new password<input type="password" autoComplete="new-password" required value={confirm} onChange={event => setConfirm(event.target.value)} placeholder="Repeat your new password" /></label>
        {error && <p className="message error" role="alert">{error}</p>}
        <button className="button button-dark full" disabled={busy}>{busy ? "Updating…" : "Update password"}<span>↗</span></button>
        <Link className="auth-return" to="/forgot-password">Need a new link?</Link>
      </form>}
  </AuthFrame>;
}
