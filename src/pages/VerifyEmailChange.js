import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AuthFrame from "../components/AuthFrame";
import { api, signOut } from "../api";

export default function VerifyEmailChange() {
  const [search] = useSearchParams();
  const token = search.get("token") || "";
  const valid = /^[A-Za-z0-9_-]{43}$/.test(token);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function confirm() {
    setBusy(true); setError("");
    try { await api("/account/email/confirm", { method: "POST", body: JSON.stringify({ token }) }); signOut(); setDone(true); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <AuthFrame eyebrow="VERIFY EMAIL CHANGE" title={done ? "Email updated" : "Confirm your new email"} intro={done ? "Your new email is verified. All devices have been signed out; use your new email to log in." : "Confirm only if you requested this change. The link works once and expires after 30 minutes."}>
    <div className="stack-form">{error && <p className="message error" role="alert">{error}</p>}{!valid && <p className="message error" role="alert">This verification link is missing or invalid.</p>}{valid && !done && <button className="button button-dark full" disabled={busy} onClick={confirm}>{busy ? "Confirming…" : "Confirm email change"}</button>}<Link className="auth-return" to="/login">Log in</Link></div>
  </AuthFrame>;
}
