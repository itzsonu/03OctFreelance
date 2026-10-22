import React, { useState } from "react";
import { api } from "../api";

export default function ProjectControls({ project, user, onEdit, onChanged }) {
  const [mode, setMode] = useState("");
  const [reason, setReason] = useState("");
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const owner = user?.role === "client";
  const editable = owner && ["Open", "Closed"].includes(project.status) && !project.freelancer && !project.agreement;
  const pending = project.cancellationRequests?.find(item => String(item._id) === String(project.pendingCancellation) && item.status === "Pending");
  const ownRequest = pending && String(pending.requestedBy) === String(user?.id);
  const cancellable = ["Open", "Closed", "In Progress"].includes(project.status) && !pending && !project.pendingAmendment;

  async function change(path, body) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api(`/projects/${project._id}/${path}`, { method: "POST", body: JSON.stringify({ version: project.__v || 0, ...body }) });
      setNotice(result.message); setMode(""); setReason(""); setResponse("");
      await onChanged();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <section className="panel project-controls" aria-label="Project management">
    <div className="panel-heading"><div><p className="eyebrow">PROJECT MANAGEMENT</p><h2>{project.status === "Cancelled" ? "Project cancelled" : "Hiring and cancellation"}</h2></div></div>
    <div className="project-controls-body">
      {error && <p className="message error" role="alert">{error}</p>}
      {notice && <p className="message success" role="status">{notice}</p>}
      {editable && <><p>{project.status === "Closed" ? "Hiring is closed. Existing proposals are retained; reopen when you are ready." : "Edit the brief before hiring, or close hiring to pause new proposals and offers."}</p><div className="project-controls-actions">
        <button className="button button-outline" disabled={busy} onClick={onEdit}>Edit project brief</button>
        <button className="button button-outline" disabled={busy} onClick={() => change("hiring", { action: project.status === "Open" ? "close" : "reopen" })}>{project.status === "Open" ? "Close hiring" : "Reopen hiring"}</button>
      </div></>}
      {project.status === "Cancelled" && <p>Milestone changes have stopped. The agreement, submissions, files, conversation and cancellation history remain available. This project cannot be reopened.</p>}
      {pending && <div className="cancellation-pending"><h3>Cancellation requested by {pending.requesterName}</h3><p>{pending.reason}</p><p>Milestone changes are paused until this request is accepted, declined or withdrawn. Accepting cancels the project and preserves its history.</p>
        <label>Response or withdrawal reason<textarea aria-label="Cancellation response" rows="3" minLength="10" maxLength="1000" value={response} onChange={event => setResponse(event.target.value)} /></label>
        <div className="project-controls-actions">{ownRequest ? <button className="button button-outline" disabled={busy || response.trim().length < 10} onClick={() => change(`cancellations/${pending._id}/respond`, { action: "withdraw", response })}>Withdraw cancellation request</button> : <>
          <button className="button button-dark" disabled={busy || response.trim().length < 10} onClick={() => change(`cancellations/${pending._id}/respond`, { action: "accept", response })}>Agree to cancel project</button>
          <button className="button button-outline" disabled={busy || response.trim().length < 10} onClick={() => change(`cancellations/${pending._id}/respond`, { action: "decline", response })}>Decline cancellation</button>
        </>}</div></div>}
      {cancellable && !mode && <button className="text-button danger" disabled={busy} onClick={() => setMode("cancel")}>{editable ? "Cancel unassigned project" : "Request cancellation"}</button>}
      {mode === "cancel" && cancellable && <form onSubmit={event => { event.preventDefault(); change("cancellations", { reason }); }}>
        <h3>{editable ? "Cancel this project?" : "Request project cancellation"}</h3>
        <p>{editable ? "This ends hiring permanently. Existing proposals and project history will remain available." : "The other participant must agree before the project is cancelled. Milestone changes pause while a request is pending; you can withdraw your request to resume."}</p>
        <label>Cancellation reason<textarea aria-label="Cancellation reason" required rows="3" minLength="10" maxLength="1000" value={reason} onChange={event => setReason(event.target.value)} /></label>
        <div className="project-controls-actions"><button className="button button-outline" type="button" disabled={busy} onClick={() => setMode("")}>Keep project</button><button className="button button-dark" disabled={busy || reason.trim().length < 10}>{busy ? "Saving…" : editable ? "Confirm project cancellation" : "Send cancellation request"}</button></div>
      </form>}
      {!!project.cancellationRequests?.length && <details className="project-history"><summary>Cancellation history ({project.cancellationRequests.length})</summary>{[...project.cancellationRequests].reverse().map(item => <article key={item._id}><strong>{item.requesterName} · {item.status}</strong><small>{new Date(item.createdAt).toLocaleString()}</small><p>{item.reason}</p>{item.response && <><strong>{item.responderName}</strong><p>{item.response}</p><small>{new Date(item.respondedAt).toLocaleString()}</small></>}</article>)}</details>}
      {!!project.listingHistory?.length && <details className="project-history"><summary>Previous project briefs ({project.listingHistory.length})</summary>{[...project.listingHistory].reverse().map(item => <article key={item._id}><strong>Brief version {item.revision + 1}: {item.before.title}</strong><small>{new Date(item.changedAt).toLocaleString()}</small><p>{item.before.description}</p><p>{item.before.requiredSkills?.join(", ")} · ₹{Number(item.before.budget).toLocaleString("en-IN")} · Due {item.before.deadline}</p><ul>{item.before.milestones?.map((step, i) => <li key={i}>{step.title} · ₹{Number(step.payment).toLocaleString("en-IN")}{step.dueDate ? ` · Due ${step.dueDate}` : ""}</li>)}</ul></article>)}</details>}
    </div>
  </section>;
}
