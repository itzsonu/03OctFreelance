import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import AttachmentList from "./AttachmentList";

const allowedFiles = ".pdf,.txt,.csv,.png,.jpg,.jpeg,.webp";

function multipart(textKey, text, files) {
  const form = new FormData();
  if (text) form.append(textKey, text);
  files.forEach(file => form.append("files", file));
  return form;
}

export default function WorkroomCasePanel({ projectId, projectStatus }) {
  const [cases, setCases] = useState([]);
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [files, setFiles] = useState({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api(`/workrooms/projects/${projectId}/disputes`);
      setCases(Array.isArray(data) ? data : []);
      setError("");
    }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function openCase(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const created = await api(`/workrooms/projects/${projectId}/disputes`, { method: "POST", body: multipart("reason", reason.trim(), evidence) });
      setCases(current => [created, ...current]); setReason(""); setEvidence([]);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function addUpdate(event, disputeId) {
    event.preventDefault();
    const text = drafts[disputeId]?.trim() || "";
    const attached = files[disputeId] || [];
    if (!text && !attached.length) return;
    setBusy(true); setError("");
    try {
      const updated = await api(`/workrooms/disputes/${disputeId}/messages`, { method: "POST", body: multipart("text", text, attached) });
      setCases(current => current.map(item => item._id === updated._id ? updated : item));
      setDrafts(current => ({ ...current, [disputeId]: "" }));
      setFiles(current => ({ ...current, [disputeId]: [] }));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const open = cases.find(item => item.status === "open");
  return <section className="panel case-panel" aria-labelledby="case-heading">
    <div className="panel-heading"><div><p className="eyebrow">PROJECT SUPPORT</p><h2 id="case-heading">Issue report</h2><p>Both participants can add context and evidence while a case is open. An admin decision records a reason but does not change project terms, milestones or money.</p></div></div>
    {error && <p className="message error" role="alert">{error}</p>}
    {loading ? <p>Loading case history…</p> : <>
      {cases.map(dispute => <article className="case-record" key={dispute._id}>
        <div className="case-record-heading"><strong>Case · {new Date(dispute.createdAt).toLocaleDateString()}</strong><span className={`status status-${dispute.status}`}>{dispute.status}</span></div>
        <ol className="case-history">{dispute.history.map(item => <li key={item._id}><div><strong>{item.author?.name || "Participant"} · {item.action === "opened" ? "Opened case" : item.action === "resolved" ? "Admin resolution" : "Update"}</strong><time>{new Date(item.createdAt).toLocaleString()}</time></div><p>{item.text}</p><AttachmentList projectId={projectId} attachments={item.attachments} /></li>)}</ol>
        {dispute.resolution && <section className="case-resolution"><h3>Resolution</h3><p>{dispute.resolution.reason}</p><small>Recorded by {dispute.resolution.admin?.name || "Admin"} · {new Date(dispute.resolution.resolvedAt).toLocaleString()}</small></section>}
        {dispute.status === "open" && <form className="case-update-form" onSubmit={event => addUpdate(event, dispute._id)}><label htmlFor={`case-reply-${dispute._id}`}>Add information or evidence<textarea id={`case-reply-${dispute._id}`} rows="3" maxLength="2000" value={drafts[dispute._id] || ""} onChange={event => setDrafts(current => ({ ...current, [dispute._id]: event.target.value }))} placeholder="Add a factual update…" /></label><label className="file-picker">Attach<input type="file" accept={allowedFiles} multiple onChange={event => setFiles(current => ({ ...current, [dispute._id]: Array.from(event.target.files || []).slice(0, 3) }))} /></label><button className="button button-outline" disabled={busy || (!(drafts[dispute._id] || "").trim() && !(files[dispute._id] || []).length)}>Add to history</button>{files[dispute._id]?.length > 0 && <small>{files[dispute._id].map(file => file.name).join(", ")}</small>}</form>}
      </article>)}
      {!open && projectStatus === "In Progress" && <form className="case-open-form" onSubmit={openCase}><h3>Open a project case</h3><label htmlFor="case-reason">Reason<textarea id="case-reason" rows="4" minLength="10" maxLength="2000" required value={reason} onChange={event => setReason(event.target.value)} placeholder="Describe the issue and what has happened so far…" /></label><label className="file-picker">Attach evidence<input type="file" accept={allowedFiles} multiple onChange={event => setEvidence(Array.from(event.target.files || []).slice(0, 3))} /></label>{evidence.length > 0 && <small>{evidence.map(file => file.name).join(", ")}</small>}<button className="button button-dark" disabled={busy || reason.trim().length < 10}>{busy ? "Opening…" : "Open case"}</button></form>}
      {projectStatus !== "In Progress" && !cases.length && <p className="form-help">Cases can be opened while a project is in progress.</p>}
    </>}
  </section>;
}