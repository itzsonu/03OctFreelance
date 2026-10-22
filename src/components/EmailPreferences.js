import React, { useEffect, useState } from "react";
import { api } from "../api";

const choices = [
  ["proposals", "Proposals", "New proposals, proposal updates, withdrawals and selection decisions."],
  ["offers", "Offers and agreements", "Offers, counter-offers, declined terms and confirmed agreements."],
  ["submissions", "Work submissions", "A milestone is submitted and ready for your review."],
  ["revisions", "Revision requests", "A client requests changes to submitted work."],
];

export default function EmailPreferences() {
  const [settings, setSettings] = useState(null);
  const [preferences, setPreferences] = useState({ proposals: false, offers: false, submissions: false, revisions: false });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    try { const data = await api("/account/notification-preferences"); setSettings(data); setPreferences(current => ({ ...current, ...data.preferences })); setError(""); }
    catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, []);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { const result = await api("/account/notification-preferences", { method: "PUT", body: JSON.stringify({ preferences }) }); setPreferences(result.preferences); setNotice(result.message); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="panel account-settings-card"><h2>Email alerts</h2><p>Choose the important events you want emailed to your current account address. Alerts start off; in-app notifications stay enabled.</p>
    {error && <p className="message error" role="alert">{error}{!settings && <button type="button" className="text-button" onClick={load}>Retry preferences</button>}</p>}
    {notice && <p className="message success" role="status">{notice}</p>}
    {!settings ? <p>Loading email preferences…</p> : <><p className="info-box">{!settings.enabled || settings.deliveryMode === "unavailable" ? "Email delivery is not active yet. You can save your choices now; sending starts after email setup is completed." : settings.deliveryMode === "local-console" ? "Local preview only: selected alerts appear in the backend terminal. No email is sent." : "Selected alerts are delivered to your current account email. Delivery can take a few moments."}</p>
      <form onSubmit={save}><div className="email-preference-list">{choices.map(([key, title, detail]) => <label key={key}><input type="checkbox" checked={preferences[key]} disabled={busy} onChange={event => setPreferences(current => ({ ...current, [key]: event.target.checked }))} /><span>{title}<small>{detail}</small></span></label>)}</div><p className="form-help">Password reset and email verification messages are separate from these optional alerts.</p><button type="submit" className="button button-outline" disabled={busy}>{busy ? "Saving preferences…" : "Save email preferences"}</button></form></>}
  </section>;
}
