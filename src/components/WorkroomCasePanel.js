import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import AttachmentList from "./AttachmentList";
import useLiveUpdates from "../useLiveUpdates";

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
  const [loaded, setLoaded] = useState(false);
  const context = useRef(null);
  const active = ctx => ctx?.alive && context.current === ctx;

  const load = useCallback(async (ctx = context.current) => {
    if (!ctx?.alive || context.current !== ctx) return;
    const version = ++ctx.version;
    try {
      const data = await api(`/workrooms/projects/${ctx.id}/disputes`);
      if (!ctx.alive || context.current !== ctx || ctx.version !== version) return;
      setCases(Array.isArray(data) ? data : []);
      setError(""); setLoaded(true);
    }
    catch (err) { if (ctx.alive && context.current === ctx && ctx.version === version) setError(err.message); }
    finally { if (ctx.alive && context.current === ctx && ctx.version === version) setLoading(false); }
  }, []);
  useEffect(() => {
    const ctx = { id: projectId, alive: true, version: 0, writing: false };
    context.current = ctx;
    setCases([]); setReason(""); setEvidence([]); setDrafts({}); setFiles({}); setBusy(false); setLoaded(false); setLoading(true); setError("");
    load(ctx);
    return () => { ctx.alive = false; };
  }, [projectId, load]);
  useLiveUpdates(event => { if (event.type === "reconnected" || (event.type === "project" && event.projectId === projectId)) load(); });

  async function openCase(event) {
    event.preventDefault();
    const ctx = context.current;
    if (!active(ctx) || ctx.writing || !loaded || error) return;
    ctx.writing = true; ctx.version++; setBusy(true); setError("");
    try {
      const created = await api(`/workrooms/projects/${projectId}/disputes`, { method: "POST", body: multipart("reason", reason.trim(), evidence) });
      if (!active(ctx)) return;
      ctx.version++;
      setCases(current => [created, ...current]); setReason(""); setEvidence([]);
      await load(ctx);
    } catch (err) { if (active(ctx)) setError(err.message); }
    finally { ctx.writing = false; if (active(ctx)) { setBusy(false); setLoading(false); } }
  }

  async function addUpdate(event, disputeId) {
    event.preventDefault();
    const text = drafts[disputeId]?.trim() || "";
    const attached = files[disputeId] || [];
    const ctx = context.current;
    if ((!text && !attached.length) || !active(ctx) || ctx.writing || error) return;
    ctx.writing = true; ctx.version++; setBusy(true); setError("");
    try {
      const updated = await api(`/workrooms/disputes/${disputeId}/messages`, { method: "POST", body: multipart("text", text, attached) });
      if (!active(ctx)) return;
      ctx.version++;
      setCases(current => current.map(item => item._id === updated._id ? updated : item));
      setDrafts(current => ({ ...current, [disputeId]: "" }));
      setFiles(current => ({ ...current, [disputeId]: [] }));
      await load(ctx);
    } catch (err) { if (active(ctx)) setError(err.message); }
    finally { ctx.writing = false; if (active(ctx)) { setBusy(false); setLoading(false); } }
  }

  const open = cases.find(item => item.status === "open");
  return <section className="panel case-panel" aria-labelledby="case-heading">
    <div className="panel-heading"><div><p className="eyebrow">PROJECT SUPPORT</p><h2 id="case-heading">Issue report</h2><p>Both participants can add context and evidence while a case is open. An admin decision records a reason but does not change project terms, milestones or money.</p></div></div>
    <button type="button" className="button button-outline" disabled={loading || busy} onClick={() => load()}>Refresh case history</button>
    {error && <p className="message error" role="alert">{error}</p>}
    {loading || context.current?.id !== projectId ? <p>Loading case history…</p> : <>
      {cases.map(dispute => <article className="case-record" key={dispute._id}>
        <div className="case-record-heading"><strong>Case · {new Date(dispute.createdAt).toLocaleDateString()}</strong><span className={`status status-${dispute.status}`}>{dispute.status}</span></div>
        <ol className="case-history">{dispute.history.map(item => <li key={item._id}><div><strong>{item.author?.name || "Participant"} · {item.action === "opened" ? "Opened case" : item.action === "resolved" ? "Admin resolution" : "Update"}</strong><time>{new Date(item.createdAt).toLocaleString()}</time></div><p>{item.text}</p><AttachmentList projectId={projectId} attachments={item.attachments} /></li>)}</ol>
        {dispute.resolution && <section className="case-resolution"><h3>Resolution</h3><p>{dispute.resolution.reason}</p><small>Recorded by {dispute.resolution.admin?.name || "Admin"} · {new Date(dispute.resolution.resolvedAt).toLocaleString()}</small></section>}
        {dispute.status === "open" && <form className="case-update-form" onSubmit={event => addUpdate(event, dispute._id)}><label htmlFor={`case-reply-${dispute._id}`}>Add information or evidence<textarea id={`case-reply-${dispute._id}`} rows="3" maxLength="2000" value={drafts[dispute._id] || ""} onChange={event => setDrafts(current => ({ ...current, [dispute._id]: event.target.value }))} placeholder="Add a factual update…" /></label><label className="file-picker">Attach<input type="file" accept={allowedFiles} multiple onChange={event => setFiles(current => ({ ...current, [dispute._id]: Array.from(event.target.files || []).slice(0, 3) }))} /></label><button className="button button-outline" disabled={busy || (!(drafts[dispute._id] || "").trim() && !(files[dispute._id] || []).length)}>Add to history</button>{files[dispute._id]?.length > 0 && <small>{files[dispute._id].map(file => file.name).join(", ")}</small>}</form>}
      </article>)}
      {loaded && !error && !open && projectStatus === "In Progress" && <form className="case-open-form" onSubmit={openCase}><h3>Open a project case</h3><label htmlFor="case-reason">Reason<textarea id="case-reason" rows="4" minLength="10" maxLength="2000" required value={reason} onChange={event => setReason(event.target.value)} placeholder="Describe the issue and what has happened so far…" /></label><label className="file-picker">Attach evidence<input type="file" accept={allowedFiles} multiple onChange={event => setEvidence(Array.from(event.target.files || []).slice(0, 3))} /></label>{evidence.length > 0 && <small>{evidence.map(file => file.name).join(", ")}</small>}<button className="button button-dark" disabled={busy || reason.trim().length < 10}>{busy ? "Opening…" : "Open case"}</button></form>}
      {projectStatus !== "In Progress" && !cases.length && <p className="form-help">Cases can be opened while a project is in progress.</p>}
    </>}
  </section>;
}
