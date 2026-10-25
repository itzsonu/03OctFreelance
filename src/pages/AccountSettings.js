import AccountData from "../components/AccountData";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Shell from "../components/Shell";
import EmailPreferences from "../components/EmailPreferences";
import { api, currentUser, signOut } from "../api";

export default function AccountSettings() {
  const navigate = useNavigate();
  const [account, setAccount] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState({ currentPassword: "", password: "", confirm: "" });
  const [email, setEmail] = useState({ currentPassword: "", email: "" });
  const [logoutPassword, setLogoutPassword] = useState("");
  const load = async () => { try { setAccount(await api("/account")); } catch (err) { setError(err.message); } };
  useEffect(() => { load(); }, []);

  async function submit(path, body, method = "POST") {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api(`/account/${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (result.signedOut) { signOut({ localOnly: true }); navigate("/login?account=updated", { replace: true }); return; }
      setNotice(result.message); setEmail({ currentPassword: "", email: "" }); await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <Shell role={currentUser()?.role || "client"} eyebrow="YOUR ACCOUNT" title="Account settings" subtitle="Manage your password, email preferences and active sign-ins.">
    {error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message success" role="status">{notice}</p>}
    {!account ? <p>Loading account…</p> : <div className="account-settings-grid">
      <section className="panel account-settings-card"><h2>Sign-in email</h2><p>{account.email}</p>{account.emailVerified ? <p className="message success">Email verified</p> : <><p>Verify your inbox to confirm this email belongs to you.</p><button className="button button-outline" disabled={busy || account.deliveryMode === "unavailable"} onClick={() => submit("email-verification", {})}>Send verification email</button>{account.deliveryMode === "unavailable" && <p className="form-help">Email delivery is currently unavailable. Please try later.</p>}</>}</section>
      <EmailPreferences />
      <AccountData />
      <section className="panel account-settings-card"><h2>Change password</h2><p>Your current sign-in email is <strong>{account.email}</strong>. Changing your password signs out every device, including this one.</p><form className="stack-form" onSubmit={event => { event.preventDefault(); if (password.password !== password.confirm) { setError("New passwords do not match."); return; } submit("password", { currentPassword: password.currentPassword, password: password.password }); }}>
        <label>Current password<input type="password" autoComplete="current-password" required value={password.currentPassword} onChange={event => setPassword(value => ({ ...value, currentPassword: event.target.value }))} /></label>
        <label>New password<input type="password" autoComplete="new-password" minLength="8" maxLength="72" required value={password.password} onChange={event => setPassword(value => ({ ...value, password: event.target.value }))} /></label>
        <label>Confirm new password<input type="password" autoComplete="new-password" required value={password.confirm} onChange={event => setPassword(value => ({ ...value, confirm: event.target.value }))} /></label>
        <button className="button button-dark" disabled={busy}>Change password and sign out</button>
      </form></section>
      <section className="panel account-settings-card"><h2>Change email</h2><p>Your email changes only after you confirm the link sent to the new inbox. Confirmation signs out all devices.</p>
        {account.deliveryMode === "local-console" && <p className="info-box">Local demo: verification links appear in the backend terminal; no email is sent.</p>}
        {account.deliveryMode === "unavailable" && <p className="info-box">Email verification is not configured. Your current email remains unchanged.</p>}
        {account.pendingEmail && <div className="info-box"><p>Awaiting confirmation: <strong>{account.pendingEmail}</strong></p><p>Expires: {new Date(account.emailChangeExpiresAt).toLocaleString()}</p><button className="text-button" disabled={busy} onClick={() => submit("email", null, "DELETE")}>Cancel email change</button></div>}
        <form className="stack-form" onSubmit={event => { event.preventDefault(); submit("email", email); }}>
          <label>New email address<input type="email" autoComplete="email" required maxLength="254" value={email.email} onChange={event => setEmail(value => ({ ...value, email: event.target.value }))} /></label>
          <label>Current password for email change<input type="password" autoComplete="current-password" required value={email.currentPassword} onChange={event => setEmail(value => ({ ...value, currentPassword: event.target.value }))} /></label>
          <button className="button button-dark" disabled={busy || account.deliveryMode === "unavailable"}>{account.deliveryMode === "local-console" ? "Print local verification link" : "Send verification link"}</button>
        </form></section>
      <section className="panel account-settings-card"><h2>Sign out all devices</h2><p>Ends existing sign-ins and live connections on every device, including this one. Pending password-reset and email-change links will also stop working.</p><form className="stack-form" onSubmit={event => { event.preventDefault(); submit("logout-all", { currentPassword: logoutPassword }); }}>
        <label>Current password to sign out all devices<input type="password" autoComplete="current-password" required value={logoutPassword} onChange={event => setLogoutPassword(event.target.value)} /></label>
        <button className="button button-outline" disabled={busy}>Sign out all devices</button>
      </form></section>
    </div>}
  </Shell>;
}
