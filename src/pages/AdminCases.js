import React, { useCallback, useEffect, useState } from "react";
import { api, downloadCaseAttachment } from "../api";
import Shell from "../components/Shell";

const dateTime = value => value ? new Date(value).toLocaleString() : "Time unavailable";

export default function AdminCases() {
  const [statusFilter, setStatusFilter] = useState("open");
  const [cases, setCases] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadCases = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api(`/admin/cases?status=${statusFilter}`);
      setCases(data);
      setError("");
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { loadCases(); }, [loadCases]);

  async function openCase(caseId) {
    setSelectedId(caseId);
    setDetail(null);
    setError("");
    try { setDetail(await api(`/admin/cases/${caseId}`)); }
    catch (err) { setError(err.message); }
  }

  async function resolveCase(event) {
    event.preventDefault();
    if (!detail || reason.trim().length < 10) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const resolved = await api(`/admin/cases/${detail._id}/resolve`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) });
      setDetail(resolved);
      setReason("");
      setNotice("Case resolved. Project milestones and terms were not changed.");
      await loadCases();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <Shell role="admin" eyebrow="PRIVATE ADMIN WORKSPACE" title="Project case review" subtitle="Review participant evidence and record a reasoned case decision.">
    {notice && <p className="message success" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss message">×</button></p>}
    {error && <p className="message error" role="alert">{error}</p>}
    <section className="panel admin-case-panel">
      <div className="panel-heading"><div><p className="eyebrow">CASE QUEUE</p><h2>Cases</h2></div><label>Show<select aria-label="Case status" value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setSelectedId(null); setDetail(null); }}><option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All</option></select></label></div>
      {loading ? <p role="status">Loading cases…</p> : cases.length === 0 ? <p className="empty-state">No {statusFilter === "all" ? "" : `${statusFilter} `}cases.</p> : <div className="admin-case-list">{cases.map(item => <button className={`admin-case-row ${selectedId === item._id ? "selected" : ""}`} type="button" key={item._id} onClick={() => openCase(item._id)}><span><strong>{item.project?.title || "Project unavailable"}</strong><small>{item.project?.client?.name || "Client"} · {item.project?.freelancer?.name || "Freelancer"} · {item.historyCount} history entries</small></span><span className={`status status-${item.status}`}>{item.status}</span></button>)}</div>}
    </section>
    {selectedId && <section className="panel admin-case-detail" aria-labelledby="admin-case-heading">
      {!detail ? <p role="status">Loading case detail…</p> : <>
        <div className="panel-heading"><div><p className="eyebrow">CASE RECORD</p><h2 id="admin-case-heading">{detail.project?.title || "Project case"}</h2><p>{detail.project?.client?.name || "Client"} · {detail.project?.freelancer?.name || "Freelancer"}</p></div><span className={`status status-${detail.status}`}>{detail.status}</span></div>
        {detail.resolution && <section className="case-resolution"><h3>Resolution</h3><p>{detail.resolution.reason}</p><small>Recorded by {detail.resolution.admin?.name || "Admin"} · {dateTime(detail.resolution.resolvedAt)}</small></section>}
        <ol className="case-history">{detail.history.map(item => <li key={item._id}><div><strong>{item.author?.name || "Participant"} · {item.action === "opened" ? "Opened case" : item.action === "resolved" ? "Admin resolution" : "Update"}</strong><time>{dateTime(item.createdAt)}</time></div><p>{item.text}</p>{item.attachments?.length > 0 && <ul className="attachment-list">{item.attachments.map(attachment => <li key={attachment._id}><button type="button" className="attachment-download" onClick={async () => { setError(""); try { await downloadCaseAttachment(detail._id, { id: attachment._id, filename: attachment.filename }); } catch (err) { setError(err.message); } }}>↓ {attachment.filename} <small>{Math.ceil((attachment.size || 0) / 1024)} KB</small></button></li>)}</ul>}</li>)}</ol>
        {detail.status === "open" && <form className="case-resolution-form" onSubmit={resolveCase}><h3>Resolve case</h3><label htmlFor="admin-resolution-reason">Decision reason<textarea id="admin-resolution-reason" required minLength="10" maxLength="2000" rows="4" value={reason} onChange={event => setReason(event.target.value)} placeholder="Record the reason for this decision…" /></label><p className="form-help">This records a case decision only. It does not change project milestones, terms, or money.</p><button className="button button-dark" disabled={busy || reason.trim().length < 10}>{busy ? "Resolving…" : "Resolve case"}</button></form>}
      </>}
    </section>}
  </Shell>;
}
