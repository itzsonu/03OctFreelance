import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import RequestRecord from "./RequestRecord";
export const fileSize = bytes => `${(bytes / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 2 })} MB`;
export default function AccountData() {
  const [storage, setStorage] = useState(null); const [request, setRequest] = useState(null);
  const [form, setForm] = useState({ currentPassword: "", message: "", acknowledged: false });
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  useEffect(() => { let live = true; Promise.all([api("/account/storage"), api("/account/deletion-request")]).then(([usage, result]) => { if (live) { setStorage(usage); setRequest(result.request); } }).catch(err => { if (live) setError(err.message); }).finally(() => { if (live) setLoading(false); }); return () => { live = false; }; }, []);
  async function submit(event, cancel = false) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { const result = await api(cancel ? `/account/deletion-request/${request._id}/cancel` : "/account/deletion-request", { method: "POST", ...(!cancel ? { body: JSON.stringify(form) } : {}) }); setRequest(result.request); setNotice(result.message); setForm({ currentPassword: "", message: "", acknowledged: false }); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const active = request && ["open", "reviewing"].includes(request.status);
  return <section className="panel account-settings-card"><h2>Your data & storage</h2>{error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message success" role="status">{notice}</p>}{loading ? <p>Loading storage and requests…</p> : <>
    {storage && <div className="info-box"><strong>{fileSize(storage.usedBytes)} of {fileSize(storage.maxBytes)} used</strong><progress aria-label="Attachment storage usage" max={storage.maxBytes} value={storage.usedBytes} /><p>{storage.usedFiles} of {storage.maxFiles} files · Up to {fileSize(storage.maxFileBytes)} each, {storage.filesPerRequest} per upload.</p><p>Usage includes pending uploads. Recorded project files are retained as evidence. <Link to="/support">Contact support</Link> if you reach the limit.</p></div>}
    <h3>Request account deletion review</h3><p>This submits a request for an administrator to review. It does not immediately delete your account, projects, messages or files. The administrator must explain the outcome and any retained records. Read our <Link to="/privacy">Privacy information</Link>.</p>
    {request && <RequestRecord request={request} />}{active ? <button className="button button-outline" disabled={busy} onClick={event => submit(event, true)}>Cancel deletion request</button> : <form className="stack-form" onSubmit={submit}><label>Reason (optional)<textarea minLength={10} maxLength={4000} value={form.message} onChange={event => setForm({ ...form, message: event.target.value })} /></label><label>Current password to request deletion<input type="password" autoComplete="current-password" required maxLength={128} value={form.currentPassword} onChange={event => setForm({ ...form, currentPassword: event.target.value })} /></label><label className="acknowledge-row"><input type="checkbox" required checked={form.acknowledged} onChange={event => setForm({ ...form, acknowledged: event.target.checked })} /><span>I understand this requests a review and does not immediately erase data.</span></label><button className="button button-outline" disabled={busy || !storage}>Request deletion review</button></form>}
  </>}</section>;
}
