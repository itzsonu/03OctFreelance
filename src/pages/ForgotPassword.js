import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import AuthFrame from "../components/AuthFrame";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState("unknown");

  useEffect(() => {
    let active = true;
    api("/auth/recovery-status").then(result => {
      if (active) setDeliveryMode(result.mode || "unknown");
    }).catch(() => { if (active) setDeliveryMode("unknown"); });
    return () => { active = false; };
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError(""); setMessage(""); setBusy(true);
    try {
      const result = await api("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email: email.trim() }) });
      setMessage(result.message);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <AuthFrame eyebrow="ACCOUNT RECOVERY" title="Forgot your password?" intro="Enter your account email to request a reset link that works for 15 minutes.">
    <form className="stack-form" onSubmit={submit}>
      {deliveryMode === "local-console" && <p className="recovery-note" role="note">Local demo: no email is sent. If the account exists, find the reset link in the backend terminal.</p>}
      {deliveryMode === "unavailable" && <p className="message error" role="alert">Password recovery is not configured on this server yet.</p>}
      <label>Email address<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" /></label>
      {error && <p className="message error" role="alert">{error}</p>}
      {message && <p className="message success" role="status">{message}</p>}
      <button className="button button-dark full" disabled={busy || deliveryMode === "unavailable"}>{busy ? "Requesting…" : deliveryMode === "local-console" ? "Print local reset link" : "Send reset link"}<span>↗</span></button>
      <Link className="auth-return" to="/login">← Back to login</Link>
    </form>
  </AuthFrame>;
}
