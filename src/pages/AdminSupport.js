import React, { useEffect, useState } from "react";
import Shell from "../components/Shell";
import Pagination from "../components/Pagination";
import RequestRecord from "../components/RequestRecord";
import usePagedList from "../usePagedList";
import { api } from "../api";
export default function AdminSupport() {
  const [status, setStatus] = useState("open"); const [kind, setKind] = useState("all");
  const list = usePagedList(`/admin/support?status=${status}&kind=${kind}`, 12);
  const [selected, setSelected] = useState(""); const [request, setRequest] = useState(null); const [nextStatus, setNextStatus] = useState("reviewing"); const [response, setResponse] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  useEffect(() => { if (!selected) { setRequest(null); return; } let live = true; setError(""); setRequest(null); setResponse(""); api(`/admin/support/${selected}`).then(result => { if (live) { setRequest(result.request); setNextStatus(result.request.status === "closed" ? "open" : "reviewing"); } }).catch(err => { if (live) setError(err.message); }); return () => { live = false; }; }, [selected]);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { const result = await api(`/admin/support/${selected}`, { method: "POST", body: JSON.stringify({ version: request.version, status: nextStatus, response }) }); setRequest(result.request); setResponse(""); setNotice(result.message); await list.reload(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <Shell role="admin" eyebrow="SUPPORT" title="Support & privacy requests" subtitle="Review requests and save replies that users can read on the support page.">
    {notice && <p className="message success" role="status">{notice}</p>}{error && <p className="message error" role="alert">{error}</p>}
    <div className="service-grid"><section className="panel account-settings-card"><h2>Request queue</h2><div className="support-filters"><label>Status<select value={status} onChange={event => { setStatus(event.target.value); list.setPage(1); }}>{["open", "reviewing", "closed", "cancelled", "all"].map(value => <option key={value}>{value}</option>)}</select></label><label>Type<select value={kind} onChange={event => { setKind(event.target.value); list.setPage(1); }}>{["all", "support", "deletion"].map(value => <option key={value}>{value}</option>)}</select></label></div>
      {list.error && <p role="alert">{list.error}</p>}{list.loading ? <p>Loading requests…</p> : list.items.length ? list.items.map(item => <button key={item._id} className="request-pick" disabled={busy} aria-pressed={selected === item._id} onClick={() => setSelected(item._id)}><strong>{item.subject}</strong><span>{item.kind} · {item.status}</span><small>{item.email} · {new Date(item.createdAt).toLocaleDateString()}</small></button>) : <p>No requests in this queue.</p>}<Pagination {...list} onPage={list.setPage} label="support requests" />
    </section><section className="panel account-settings-card"><h2>Request details</h2>{!selected ? <p>Select a request to review it.</p> : !request ? <p>Loading request…</p> : <><p>Contact email: {request.email}. Guest contact addresses are unverified.</p><RequestRecord request={request} />{request.kind === "deletion" && <p className="info-box">This is a deletion review. Updating or closing it does not erase data. Verify ownership, review shared project and case records, and explain the outcome and any records retained. Do not mark a request fulfilled unless the separate data-handling work has actually been carried out.</p>}{request.status === "cancelled" ? <p>This request was cancelled by its owner.</p> : <form className="stack-form" onSubmit={save}><label>New status<select value={nextStatus} onChange={event => setNextStatus(event.target.value)}><option value="open">Open</option><option value="reviewing">Reviewing</option><option value="closed">Close review</option></select></label><label>Reply to requester<textarea required rows={6} minLength={10} maxLength={4000} value={response} onChange={event => setResponse(event.target.value)} /></label><button className="button button-dark" disabled={busy}>Save reply & status</button><button type="button" className="text-button" disabled={busy} onClick={async () => { try { setRequest((await api(`/admin/support/${selected}`)).request); setError(""); } catch (err) { setError(err.message); } }}>Refresh details</button></form>}</>}
    </section></div>
  </Shell>;
}
