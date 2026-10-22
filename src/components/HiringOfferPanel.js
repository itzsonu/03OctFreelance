import { Link } from "react-router-dom";
import React, { useEffect, useState } from "react";
import { api, currentUser } from "../api";
import { toCents } from "../money";
import { todayISO, validateSchedule } from "../projectDates";

const today = todayISO;
const money = value => `₹${Number(value || 0).toLocaleString("en-IN")}`;

function termsDraft(application, project) {
  const current = application.offers?.find(item => String(item._id) === String(application.currentOfferId));
  const terms = current && (current.listingRevision || 0) === (project.listingRevision || 0) ? current.terms : null;
  const amount = terms?.amount ?? application.proposedPrice ?? project.budget ?? 0;
  const source = terms?.milestones || (project.milestones?.length ? project.milestones : [{ title: "Delivery", description: "Complete and review the agreed deliverable.", payment: amount, dueDate: project.deadline || "" }]);
  const milestones = source.map((item, index) => ({
    title: item.title, description: item.description || "", payment: String(item.payment), dueDate: item.dueDate || "",
    dependsOn: terms ? (item.dependsOn ?? (index ? [index - 1] : [])) : project.hasExplicitDependencies
      ? (item.dependsOn || []).map(id => source.findIndex(prior => String(prior._id) === String(id?._id || id)))
      : (index ? [index - 1] : []),
  }));
  return {
    scope: terms?.scope || project.description || application.proposal || "",
    amount: String(amount),
    deliveryDate: terms?.deliveryDate || project.deadline || today(),
    milestones,
  };
}

export default function HiringOfferPanel({ application: initialApplication, project, role, onChange, onAssigned }) {
  const [application, setApplication] = useState(initialApplication);
  const [draft, setDraft] = useState(() => termsDraft(initialApplication, project));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const userId = typeof currentUser === "function" ? currentUser()?.id : null;

  useEffect(() => {
    setApplication(initialApplication);
  }, [initialApplication]);

  const currentOffer = application.offers?.find(item => String(item._id) === String(application.currentOfferId));
  const openOffer = currentOffer?.status === "OPEN" && application.currentOfferState === "OPEN";
  const canHire = project.status === "Open" && !project.freelancer;
  const currentRevision = !currentOffer || (currentOffer.listingRevision || 0) === (project.listingRevision || 0);
  const isRecipient = canHire && currentRevision && openOffer && String(currentOffer.createdBy) !== String(userId);
  const milestoneCents = draft.milestones.map(milestone => toCents(milestone.payment));
  const totalCents = milestoneCents.reduce((sum, value) => sum + (value || 0), 0);
  const milestoneTotal = totalCents / 100;
  const matchesAmount = milestoneCents.every(value => value !== null && value >= 0) && toCents(draft.amount) !== null && totalCents === toCents(draft.amount);

  function removeMilestone(index) {
    const dependent = draft.milestones.map((step, i) => step.dependsOn.includes(index) ? i + 1 : null).filter(Boolean);
    if (dependent.length) { setError(`Cannot remove Step ${index + 1}: Steps ${dependent.join(", ")} depend on it. Change their Unlock after selections first.`); return; }
    setError("");
    setDraft(current => ({ ...current, milestones: current.milestones.filter((_, i) => i !== index).map(item => ({ ...item, dependsOn: item.dependsOn.filter(prior => prior !== index).map(prior => prior > index ? prior - 1 : prior) })) }));
  }

  function toggleDependency(index, priorIndex) {
    setDraft(current => ({ ...current, milestones: current.milestones.map((item, i) => i === index ? { ...item, dependsOn: item.dependsOn.includes(priorIndex) ? item.dependsOn.filter(prior => prior !== priorIndex) : [...item.dependsOn, priorIndex].sort((a, b) => a - b) } : item) }));
  }

  function replaceApplication(updated) {
    setApplication(updated);
    onChange?.(updated);
  }

  async function sendOffer(event) {
    event.preventDefault();
    try { validateSchedule(draft.deliveryDate, draft.milestones); }
    catch (err) { setError(err.message); return; }
    setBusy(true); setError(""); setNotice("");
    const terms = { ...draft, amount: Number(draft.amount), milestones: draft.milestones.map(item => ({ ...item, payment: Number(item.payment) })) };
    try {
      const result = await api(`/applications/${application._id}/offer`, { method: "POST", body: JSON.stringify({ ...(openOffer ? { replacesOfferId: currentOffer._id } : {}), terms }) });
      replaceApplication(result.application);
      setDraft(termsDraft(result.application, project));
      setEditing(false);
      setNotice(`Offer version ${result.application.offers.at(-1).version} sent.`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function respond(action) {
    if (!currentOffer) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api(`/applications/${application._id}/offer/${currentOffer._id}/${action}`, { method: "POST", body: JSON.stringify({}) });
      if (result.application) replaceApplication(result.application);
      if (result.project) {
        setNotice("Both participants agreed to these terms. The freelancer is assigned.");
        onAssigned?.(result);
      } else setNotice(action === "decline" ? "Offer declined. This proposal is closed." : "Offer accepted and assigned.");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  function editTerms() {
    setDraft(termsDraft(application, project));
    setEditing(true);
    setError("");
  }

  return <section className="hiring-offer-panel" aria-label="Project offer and agreement">
    {!canHire && application.status === "PENDING" && <p className="form-help">Hiring is closed for this project. Your proposal and offer history are retained.</p>}
    {role === "freelancer" && canHire && project._id && <Link to={`/jobs/${project._id}?from=applications`}>Read latest project brief →</Link>}
    {!currentRevision && <p className="form-help">The project brief changed. Review the latest brief and ask the client for a fresh offer.</p>}
    <div className="hiring-offer-heading"><div><strong>Terms and agreement</strong><small>Proposed amounts are not payments.</small></div>{application.status === "ACCEPTED" && <span className="status status-completed">Agreed</span>}</div>
    {application.offers?.length > 0 && <div className="offer-version-list"><h4>Offer history</h4>{[...application.offers].reverse().map(offer => <article className="offer-version" key={offer._id}><div><strong>Version {offer.version}</strong><span className={`offer-state ${offer.status.toLowerCase()}`}>{offer.status === "OPEN" ? "Awaiting response" : offer.status.toLowerCase()}</span></div><p>{String(offer.createdBy) === String(userId) ? "Proposed by you" : `Proposed by ${role === "client" ? "freelancer" : "client"}`} · {new Date(offer.createdAt).toLocaleString()} · {money(offer.terms.amount)} planned · due {offer.terms.deliveryDate}</p><p className="offer-scope">{offer.terms.scope}</p><ul>{offer.terms.milestones.map((milestone, index) => <li key={`${offer._id}-${index}`}>{milestone.title} · {money(milestone.payment)} planned · {milestone.dependsOn === undefined ? (index ? `After step ${index}` : "Available from the start") : milestone.dependsOn.length ? `After steps ${milestone.dependsOn.map(prior => prior + 1).join(", ")}` : "Available from the start"}{milestone.dueDate ? ` · ${milestone.dueDate}` : ""}</li>)}</ul><small>Agreed by {offer.acceptances.map(acceptance => String(acceptance.actor) === String(userId) ? "you" : role === "client" ? "freelancer" : "client").join(" and ")}</small></article>)}</div>}
    {application.status === "ACCEPTED" && application.offers?.length === 0 && <p className="form-help">Legacy accepted application. The original agreement terms were not recorded.</p>}
    {canHire && openOffer && isRecipient && <div className="offer-response-actions"><p>Review version {currentOffer.version}. Accepting assigns the freelancer and opens the shared workroom.</p><button className="button button-dark" disabled={busy} onClick={() => respond("accept")}>Accept version {currentOffer.version}</button><button className="button button-outline" disabled={busy} onClick={() => respond("decline")}>Decline offer</button><button className="text-button" disabled={busy} onClick={editTerms}>Counter with terms</button></div>}
    {canHire && openOffer && role === "freelancer" && !isRecipient && <p className="offer-waiting">Your version {currentOffer.version} is waiting for the client.</p>}
    {canHire && application.status === "PENDING" && role === "client" && !editing && <button className="button button-outline" type="button" onClick={editTerms}>{openOffer ? "Update or counter terms" : "Propose terms"}</button>}
    {canHire && application.status === "PENDING" && role === "freelancer" && !openOffer && !editing && <p className="offer-waiting">Waiting for the client to propose terms.</p>}
    {canHire && editing && <form className="offer-editor" onSubmit={sendOffer}>
      <label>Final scope<textarea required minLength="10" maxLength="5000" rows="4" value={draft.scope} onChange={event => setDraft(current => ({ ...current, scope: event.target.value }))} /></label>
      <div className="offer-editor-grid"><label>Proposed amount<input type="number" min="0.01" step="0.01" required value={draft.amount} onChange={event => setDraft(current => ({ ...current, amount: event.target.value }))} /></label><label>Delivery date<input type="date" required min={today()} value={draft.deliveryDate} onChange={event => setDraft(current => ({ ...current, deliveryDate: event.target.value }))} /></label></div>
      <div className="offer-milestone-editor"><div><strong>Milestones</strong><small>{matchesAmount ? "Planned amounts match the offer total." : `Planned amounts: ${money(milestoneTotal)} · offer total: ${money(draft.amount)}`}</small></div>{draft.milestones.map((milestone, index) => <fieldset key={index}><legend>Milestone {index + 1}</legend><label>Title<input required maxLength="120" value={milestone.title} onChange={event => setDraft(current => ({ ...current, milestones: current.milestones.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) }))} /></label><label>Details<input maxLength="1000" value={milestone.description} onChange={event => setDraft(current => ({ ...current, milestones: current.milestones.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item) }))} /></label><div className="offer-editor-grid"><label>Planned amount<input type="number" min="0" step="0.01" required value={milestone.payment} onChange={event => setDraft(current => ({ ...current, milestones: current.milestones.map((item, itemIndex) => itemIndex === index ? { ...item, payment: event.target.value } : item) }))} /></label><label>Target date<input type="date" min={today()} max={draft.deliveryDate} value={milestone.dueDate} onChange={event => setDraft(current => ({ ...current, milestones: current.milestones.map((item, itemIndex) => itemIndex === index ? { ...item, dueDate: event.target.value } : item) }))} /></label></div>{index > 0 && <div className="dependency-picker"><strong>Unlock after</strong>{draft.milestones.slice(0, index).map((prior, priorIndex) => <label key={priorIndex}><input type="checkbox" checked={milestone.dependsOn.includes(priorIndex)} onChange={() => toggleDependency(index, priorIndex)} />Step {priorIndex + 1} · {prior.title || "Untitled"}</label>)}<small>Leave all unchecked to allow this step from the start.</small></div>}{draft.milestones.length > 1 && <button className="text-button" type="button" onClick={() => removeMilestone(index)}>Remove milestone</button>}</fieldset>)}{draft.milestones.length < 20 && <button className="button button-outline" type="button" onClick={() => setDraft(current => ({ ...current, milestones: [...current.milestones, { title: "", description: "", payment: "0", dueDate: "", dependsOn: current.milestones.length ? [current.milestones.length - 1] : [] }] }))}>Add milestone</button>}</div>
      {error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message success" role="status">{notice}</p>}
      <div className="dialog-actions"><button className="button button-outline" type="button" onClick={() => setEditing(false)}>Cancel</button><button className="button button-dark" disabled={busy || !matchesAmount || draft.milestones.length < 1}>{busy ? "Sending…" : openOffer ? "Send new version" : "Send offer"}</button></div>
    </form>}
    {error && !editing && <p className="message error" role="alert">{error}</p>}{notice && !editing && <p className="message success" role="status">{notice}</p>}
  </section>;
}
