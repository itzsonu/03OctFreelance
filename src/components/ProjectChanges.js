import React, { useEffect, useState } from "react";
import { api } from "../api";
import { toCents } from "../money";
import { todayISO } from "../projectDates";

const recorded = step => step.status === "completed" || !!step.submittedWork || !!step.submissions?.length || !!step.revisionRequests?.length || !!step.revisionCount;
const money = amount => `₹${Number(amount || 0).toLocaleString("en-IN")}`;
function draftFor(project) {
  return { version: project.__v || 0, scope: project.description || "", amount: String(project.budget), deliveryDate: project.deadline, reason: "", milestones: project.milestones.map((step, i, steps) => ({ milestoneId: step._id, title: step.title, description: step.description || "", payment: String(step.payment), dueDate: step.dueDate || "", dependsOn: project.hasExplicitDependencies ? (step.dependsOn || []).map(id => steps.findIndex(prior => String(prior._id) === String(id))) : (i ? [i - 1] : []) })) };
}
function Terms({ terms }) {
  return <div className="change-terms"><p className="change-scope">{terms.scope}</p><p><strong>{money(terms.amount)} planned</strong> · Delivery: {terms.deliveryDate}</p><ol>{terms.milestones.map((step, i) => <li key={i}><strong>{step.title}</strong> · {money(step.payment)}{step.dueDate ? ` · Due ${step.dueDate}` : ""}<p>{step.description}</p><small>{step.dependsOn?.length ? `After steps ${step.dependsOn.map(index => index + 1).join(", ")}` : "Available from the start"}</small></li>)}</ol></div>;
}

export default function ProjectChanges({ project, user, onChanged }) {
  const [draft, setDraft] = useState(null);
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = project.amendments?.find(item => String(item._id) === String(project.pendingAmendment) && item.status === "Pending");
  const own = pending && String(pending.requestedBy) === String(user?.id);
  useEffect(() => { setResponse(""); if (project.pendingAmendment) setDraft(null); }, [project.pendingAmendment]);
  const editable = project.status === "In Progress" && !project.pendingCancellation && !pending;
  const oldSteps = new Map(project.milestones.map(step => [String(step._id), step]));
  const changeStep = (i, values) => setDraft(value => ({ ...value, milestones: value.milestones.map((step, index) => index === i ? { ...step, ...values } : step) }));
  const amountsMatch = draft && toCents(draft.amount) > 0 && draft.milestones.every(step => toCents(step.payment) !== null && toCents(step.payment) >= 0) && draft.milestones.reduce((sum, step) => sum + toCents(step.payment), 0) === toCents(draft.amount);

  async function save(path, body) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api(`/projects/${project._id}/${path}`, { method: "POST", body: JSON.stringify({ version: project.__v || 0, ...body }) });
      setNotice(result.message); setDraft(null); await onChanged();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  function remove(i) {
    if (draft.milestones.some(step => step.dependsOn.includes(i))) { setError("Change the dependent steps before removing this milestone."); return; }
    setDraft(value => ({ ...value, milestones: value.milestones.filter((_, index) => index !== i).map(step => ({ ...step, dependsOn: step.dependsOn.map(index => index > i ? index - 1 : index) })) }));
  }

  return <section className="panel project-changes" aria-label="Agreed project changes"><div className="panel-heading"><div><p className="eyebrow">SCOPE AND AGREEMENT</p><h2>Project changes</h2></div></div><div className="project-controls-body">
    {error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message success" role="status">{notice}</p>}
    <p className="change-scope"><strong>Current scope:</strong> {project.description || "No scope provided"}</p>
    {project.agreement && <details className="project-history"><summary>Original agreement</summary><Terms terms={project.agreement.terms} /></details>}
    {pending && <div className="cancellation-pending"><h3>Change proposed by {pending.requesterName}</h3><p>{pending.reason}</p><p>Current terms are unchanged. Milestone changes pause while you review this request. Compare the proposed plan below with the current milestone journey before agreeing.</p><Terms terms={pending.terms} /><label>Response or withdrawal reason<textarea aria-label="Project change response" rows="3" maxLength="1000" value={response} onChange={event => setResponse(event.target.value)} /></label><div className="project-controls-actions">
      {own ? <button className="button button-outline" disabled={busy || response.trim().length < 10} onClick={() => save(`changes/${pending._id}/respond`, { action: "withdraw", response })}>Withdraw change request</button> : <><button className="button button-dark" disabled={busy || response.trim().length < 10} onClick={() => save(`changes/${pending._id}/respond`, { action: "accept", response })}>Agree to proposed changes</button><button className="button button-outline" disabled={busy || response.trim().length < 10} onClick={() => save(`changes/${pending._id}/respond`, { action: "decline", response })}>Decline changes</button></>}
    </div></div>}
    {editable && !draft && <><p>Either participant can propose new scope, dates or planned amounts. Both must agree. Approved milestones remain unchanged; submitted work and files stay in their original milestone history.</p><button className="button button-outline" onClick={() => { setDraft(draftFor(project)); setError(""); }}>Propose project change</button></>}
    {draft && editable && <form className="stack-form change-editor" onSubmit={event => { event.preventDefault(); const { version, reason, ...terms } = draft; save("changes", { version, reason, terms }); }}>
      <label>Reason for change<textarea required minLength="10" maxLength="1000" value={draft.reason} onChange={event => setDraft(value => ({ ...value, reason: event.target.value }))} /></label>
      <label>Proposed scope<textarea required minLength="10" maxLength="5000" rows="4" value={draft.scope} onChange={event => setDraft(value => ({ ...value, scope: event.target.value }))} /></label>
      <div className="form-row"><label>Proposed total (₹)<input required type="number" min="0.01" step="0.01" value={draft.amount} onChange={event => setDraft(value => ({ ...value, amount: event.target.value }))} /></label><label>Proposed delivery date<input required type="date" min={todayISO()} value={draft.deliveryDate} onChange={event => setDraft(value => ({ ...value, deliveryDate: event.target.value }))} /></label></div>
      {draft.milestones.map((step, i) => { const previous = oldSteps.get(step.milestoneId); const approved = previous?.status === "completed"; return <fieldset className="change-step" key={step.milestoneId || `new-${i}`}><legend>Milestone {i + 1}{approved ? " · Approved, retained unchanged" : ""}</legend>
        <label>Milestone title<input required maxLength="120" disabled={approved} value={step.title} onChange={event => changeStep(i, { title: event.target.value })} /></label><label>Milestone details<textarea maxLength="1000" disabled={approved} value={step.description} onChange={event => changeStep(i, { description: event.target.value })} /></label>
        <div className="form-row"><label>Planned amount (₹)<input required type="number" min="0" step="0.01" disabled={approved} value={step.payment} onChange={event => changeStep(i, { payment: event.target.value })} /></label><label>Target date<input type="date" min={todayISO()} max={draft.deliveryDate} disabled={approved} value={step.dueDate} onChange={event => changeStep(i, { dueDate: event.target.value })} /></label></div>
        {i > 0 && <fieldset className="dependency-picker"><legend>Unlock after</legend>{draft.milestones.slice(0, i).map((prior, index) => <label key={index}><input type="checkbox" disabled={previous && recorded(previous)} checked={step.dependsOn.includes(index)} onChange={() => changeStep(i, { dependsOn: step.dependsOn.includes(index) ? step.dependsOn.filter(value => value !== index) : [...step.dependsOn, index].sort((a, b) => a - b) })} />Step {index + 1} · {prior.title || "Untitled"}</label>)}</fieldset>}
        {(!previous || !recorded(previous)) && draft.milestones.length > 1 && <button className="text-button" type="button" onClick={() => remove(i)}>Remove unstarted milestone</button>}
      </fieldset>; })}
      {draft.milestones.length < 20 && <button className="button button-outline" type="button" onClick={() => setDraft(value => ({ ...value, milestones: [...value.milestones, { milestoneId: null, title: "", description: "", payment: "0", dueDate: "", dependsOn: value.milestones.length ? [value.milestones.length - 1] : [] }] }))}>Add milestone</button>}
      <p className="form-help">{amountsMatch ? "Milestone planned amounts match the proposed total." : "Milestone planned amounts must add up to the proposed total."} This app does not process payments.</p>
      <div className="project-controls-actions"><button className="button button-outline" type="button" disabled={busy} onClick={() => setDraft(null)}>Discard proposed changes</button><button className="button button-dark" disabled={busy || !amountsMatch}>{busy ? "Sending…" : "Send change request"}</button></div>
    </form>}
    {!!project.amendments?.length && <details className="project-history"><summary>Change request history ({project.amendments.length})</summary>{[...project.amendments].reverse().map(item => <article key={item._id}><strong>{item.requesterName} · {item.status}</strong><small>{new Date(item.createdAt).toLocaleString()}</small><p>{item.reason}</p><Terms terms={item.terms} />{item.before && <p>Previous agreed plan: {money(item.before.amount)} · Delivery {item.before.deliveryDate}</p>}{item.response && <p>{item.responderName}: {item.response}</p>}</article>)}</details>}
  </div></section>;
}
