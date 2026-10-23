import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ServicePage from "../components/ServicePage";
import RequestRecord from "../components/RequestRecord";
import Pagination from "../components/Pagination";
import usePagedList from "../usePagedList";
import { api, restoreSession } from "../api";
const feedbackTopics = { "project-suggestions": "Project suggestions feedback", "profile-setup": "Profile setup feedback" };
export default function Support() {
  const [search] = useSearchParams();
  const feedbackTopic = Object.hasOwn(feedbackTopics, search.get("topic")) ? feedbackTopics[search.get("topic")] : "";
  const [identity, setIdentity] = useState(undefined);
  const [form, setForm] = useState(() => ({ email: "", subject: feedbackTopic, message: "" }));
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(""); const [savedCode, setSavedCode] = useState(""); const [tracked, setTracked] = useState(null);
  const requests = usePagedList("/account/support", 10, Boolean(identity));
  useEffect(() => { if (feedbackTopic) setForm(value => !value.subject && !value.message ? { ...value, subject: feedbackTopic } : value); }, [feedbackTopic]);
  useEffect(() => { let live = true; restoreSession().then(user => { if (live) setIdentity(user || null); }).catch(err => { if (live) { setIdentity(null); setError(err.message); } }); return () => { live = false; }; }, []);
  async function send(event) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const result = await api(identity ? "/account/support" : "/support", { method: "POST", body: JSON.stringify(form) });
      setNotice(result.message); setForm(value => ({ ...value, subject: "", message: "" }));
      if (result.trackingCode) { setSavedCode(result.trackingCode); setCode(result.trackingCode); setTracked(result.request); }
      else await requests.reload();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function track(event) {
    event.preventDefault(); setBusy(true); setError(""); setTracked(null);
    try { setTracked((await api("/support/status", { method: "POST", body: JSON.stringify({ trackingCode: code.trim() }) })).request); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <ServicePage title="How can we help?" intro="Ask about your account, report a problem, or raise a privacy concern. Replies appear here; this form does not send email.">
    {feedbackTopic && <div className="info-box"><strong>{feedbackTopic}</strong><p>Tell us what you were trying to do, what happened, and what would help. For suggestions, explain which skills or field matched or did not match. Feedback is sent only when you submit this form and is private to you and the administrators.</p><Link to="/freelancer-dashboard">← Back to projects</Link></div>}
    {error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message success" role="status">{notice}</p>}
    <div className="service-grid"><section className="panel account-settings-card"><h2>Send a request</h2><p>For a delivery disagreement, open a case inside the project. Do not include passwords, login codes or payment details.</p><p>Account deletion review is available in <Link to="/account">Account settings</Link>. If you cannot sign in, explain the issue below; the administrator will need to verify ownership.</p>
      <form className="stack-form" onSubmit={send}>{!identity && <label>Contact email<input type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>}
        <label>Subject<input required minLength={5} maxLength={120} value={form.subject} onChange={event => setForm({ ...form, subject: event.target.value })} /></label>
        <label>How can we help?<textarea required minLength={10} maxLength={4000} rows={6} value={form.message} onChange={event => setForm({ ...form, message: event.target.value })} /></label>
        <button className="button button-dark" disabled={busy || identity === undefined}>{busy ? "Please wait…" : "Submit request"}</button>
      </form>{savedCode && <div className="info-box" role="status"><strong>Save your private tracking code</strong><p>Keep this code to read replies later. Anyone with the code can read your request.</p><code className="tracking-code">{savedCode}</code></div>}
    </section><section className="panel account-settings-card"><h2>Read replies</h2><form className="stack-form" onSubmit={track}><label>Private tracking code<input required autoComplete="off" maxLength={43} value={code} onChange={event => setCode(event.target.value)} /></label><button className="button button-outline" disabled={busy}>Check guest request</button></form>{tracked && <RequestRecord request={tracked} />}
      {identity && <><h3>Your requests</h3><button className="text-button" disabled={requests.loading} onClick={requests.reload}>Refresh requests</button>{requests.error && <p role="alert">{requests.error}</p>}{requests.loading ? <p role="status">Loading requests…</p> : requests.items.length ? requests.items.map(request => <RequestRecord key={request._id} request={request} />) : <p>No requests yet.</p>}<Pagination {...requests} onPage={requests.setPage} label="requests" /></>}
    </section></div>
  </ServicePage>;
}
