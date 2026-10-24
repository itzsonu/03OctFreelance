import { toCents } from "../money";
import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import useDialogAccessibility from "../useDialogAccessibility";
import { todayISO, validateSchedule } from "../projectDates";

const freshStep = index => ({ title: "", description: "", payment: "", dueDate: "", dependsOn: index ? [index - 1] : [] });
const initial = () => ({ title: "", description: "", category: "", customCategory: "", requiredSkills: "", budget: "", deadline: "", milestones: [freshStep(0)] });
const parseSkills = value => [...new Map(value.split(",").map(skill => skill.trim()).filter(Boolean).map(skill => [skill.toLowerCase(), skill])).values()];
const planSignature = form => JSON.stringify([form.title.trim(), form.description.trim(), form.category, form.category === "Other" ? form.customCategory.trim() : "", parseSkills(form.requiredSkills), Number(form.budget), form.deadline]);

function projectToForm(project) {
  const steps = project.milestones || [];
  return { title: project.title || "", description: project.description || "", category: project.category || "Other", customCategory: project.customCategory || "", requiredSkills: (project.requiredSkills || []).join(", "), budget: String(project.budget), deadline: project.deadline || "", milestones: steps.map((step, index) => ({ title: step.title, description: step.description || "", payment: String(step.payment), dueDate: step.dueDate || "", dependsOn: project.hasExplicitDependencies ? (step.dependsOn || []).map(id => steps.findIndex(prior => String(prior._id) === String(id?._id || id))).filter(i => i >= 0) : (index ? [index - 1] : []) })) };
}

export default function ProjectForm({ onClose, onCreated, onSaved, initialProject, initialDraft }) {
  const dialogRef = useDialogAccessibility(requestClose);
  const startingForm = useRef(initialProject ? projectToForm(initialProject) : initialDraft?.form || initial());
  const draftRef = useRef(initialDraft || null);
  const [form, setForm] = useState(startingForm.current);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);
  const aiAvailable = Boolean(aiStatus?.available);
  const requestVersion = useRef(0);
  const skillVersion = useRef(0);
  const [skillPreview, setSkillPreview] = useState(null);
  const [extractingSkills, setExtractingSkills] = useState(false);
  const [aiPlanFailed, setAiPlanFailed] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [draftNotice, setDraftNotice] = useState(initialDraft ? "Saved draft opened. Review dates and complete the brief before publishing." : "");
  const keepEditingRef = useRef(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(startingForm.current);
  const categoryReady = Boolean(form.category) && (form.category !== "Other" || form.customCategory.trim().length >= 2);

  function requestClose() {
    if (busy) { setError("Please wait for saving to finish."); return; }
    if (confirmClose) { setConfirmClose(false); return; }
    if (dirty) setConfirmClose(true); else onClose();
  }

  useEffect(() => { if (confirmClose) keepEditingRef.current?.focus(); }, [confirmClose]);
  useEffect(() => {
    if (!dirty && !busy) return undefined;
    const warnBeforeLeaving = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty, busy]);

  useEffect(() => {
    let active = true;
    api("/projects/ai-planning-status").then(result => { if (active) setAiStatus(result); }).catch(() => {});
    return () => { active = false; requestVersion.current += 1; skillVersion.current += 1; };
  }, []);

  function updateProject(key, value) {
    requestVersion.current += 1;
    setForm(current => ({ ...current, [key]: value }));
    setPreview(null);
    setSuggesting(false);
    setAiPlanFailed(false);
    if (["title", "description", "category", "customCategory"].includes(key)) {
      skillVersion.current += 1;
      setSkillPreview(null);
      setExtractingSkills(false);
    }
  }

  async function extractSkills() {
    const version = ++skillVersion.current;
    setError(""); setExtractingSkills(true); setSkillPreview(null);
    try {
      const result = await api("/projects/suggest-skills", { method: "POST", body: JSON.stringify({
        title: form.title.trim(), description: form.description.trim(), category: form.category,
        customCategory: form.category === "Other" ? form.customCategory.trim() : "",
      }) });
      if (skillVersion.current === version) setSkillPreview(result);
    } catch (err) { if (skillVersion.current === version) setError(err.message); }
    finally { if (skillVersion.current === version) setExtractingSkills(false); }
  }

  function skillAdded(suggestion) {
    const aliases = [suggestion.skill, ...suggestion.aliases].map(value => value.toLowerCase());
    return parseSkills(form.requiredSkills).some(skill => aliases.includes(skill.toLowerCase()));
  }

  function addSuggestedSkill(suggestion) {
    const skills = parseSkills(form.requiredSkills);
    if (skills.length >= 10 || skillAdded(suggestion)) return;
    updateProject("requiredSkills", [...skills, suggestion.skill].join(", "));
  }

  async function suggestPlan(method = "guided") {
    setError("");
    setAiPlanFailed(false);
    if (!categoryReady) { setError("Choose a category and, for Other, describe the project field."); return; }
    try { if (form.deadline) validateSchedule(form.deadline); }
    catch (err) { setError(err.message); return; }
    setSuggesting(true);
    const signature = planSignature(form);
    const version = ++requestVersion.current;
    try {
      const result = await api(method === "ai" ? "/projects/ai-suggest-milestones" : "/projects/suggest-milestones", { method: "POST", body: JSON.stringify({
        title: form.title.trim(), description: form.description.trim(), category: form.category, customCategory: form.category === "Other" ? form.customCategory.trim() : "", requiredSkills: parseSkills(form.requiredSkills), budget: Number(form.budget), deadline: form.deadline,
      }) });
      if (requestVersion.current === version) setPreview({ ...result, signature });
    } catch (err) { if (requestVersion.current === version) { setError(err.message); setAiPlanFailed(method === "ai"); } }
    finally { if (requestVersion.current === version) setSuggesting(false); }
  }

  function useSuggestedPlan() {
    if (!preview || preview.signature !== planSignature(form)) return;
    setForm(current => ({ ...current, milestones: preview.suggestions.map(step => ({
      title: step.title, description: step.description, payment: String(step.payment), dueDate: step.dueDate || "", dependsOn: step.dependsOn,
    })) }));
    setPreview(null);
  }

  function updateStep(index, changes) {
    setForm(current => ({ ...current, milestones: current.milestones.map((step, i) => i === index ? { ...step, ...changes } : step) }));
  }

  function removeStep(index) {
    const dependent = form.milestones.map((step, i) => step.dependsOn.includes(index) ? i + 1 : null).filter(Boolean);
    if (dependent.length) { setError(`Cannot remove Step ${index + 1}: Steps ${dependent.join(", ")} depend on it. Change their Unlock after selections first.`); return; }
    setError("");
    setForm(current => ({ ...current, milestones: current.milestones.filter((_, i) => i !== index).map(step => ({
      ...step,
      dependsOn: step.dependsOn.filter(value => value !== index).map(value => value > index ? value - 1 : value),
    })) }));
  }

  function toggleDependency(index, priorIndex) {
    const selected = form.milestones[index].dependsOn;
    updateStep(index, { dependsOn: selected.includes(priorIndex) ? selected.filter(value => value !== priorIndex) : [...selected, priorIndex].sort((a, b) => a - b) });
  }

  async function persistDraft() {
    const current = draftRef.current;
    const result = await api(current ? `/project-drafts/${current._id}` : "/project-drafts", { method: current ? "PATCH" : "POST", body: JSON.stringify({ form, ...(current ? { version: current.__v } : {}) }) });
    draftRef.current = result.draft;
    startingForm.current = form;
    return result.draft;
  }

  async function saveForLater() {
    setBusy(true); setError("");
    try { await persistDraft(); setConfirmClose(false); setDraftNotice("Draft saved to your account."); if (onSaved) onSaved(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!categoryReady) { setError("Choose a category and, for Other, describe the project field."); return; }
    const skills = parseSkills(form.requiredSkills);
    if (skills.length < 1 || skills.length > 10 || skills.some(skill => skill.length > 40)) { setError("Add between 1 and 10 required skills, up to 40 characters each, separated by commas."); return; }
    const budget = Number(form.budget);
    const milestones = form.milestones.map(step => ({ title: step.title.trim(), description: step.description.trim(), payment: Number(step.payment || 0), dueDate: step.dueDate, dependsOn: step.dependsOn }));
    try { validateSchedule(form.deadline, milestones); }
    catch (err) { setError(err.message); return; }
    if (toCents(budget) === null || milestones.some(step => toCents(step.payment) === null)) { setError("Amounts must use no more than two decimal places."); return; }
    if (milestones.reduce((sum, step) => sum + toCents(step.payment), 0) > toCents(budget)) { setError("Milestone amounts exceed the project budget."); return; }
    setBusy(true);
    try {
      if (draftRef.current) {
        const draft = draftRef.current.state === "publishing" || draftRef.current.state === "published" ? draftRef.current : await persistDraft();
        const result = await api(`/project-drafts/${draft._id}/publish`, { method: "POST", body: JSON.stringify({ version: draft.__v }) });
        onCreated(result.project);
        return;
      }
      const result = await api(initialProject ? `/projects/${initialProject._id}/listing` : "/projects/create", { method: initialProject ? "PATCH" : "POST", body: JSON.stringify({ ...(initialProject ? { version: initialProject.__v || 0 } : {}), title: form.title.trim(), description: form.description.trim(), category: form.category, customCategory: form.category === "Other" ? form.customCategory.trim() : "", requiredSkills: skills, budget, deadline: form.deadline, milestones }) });
      onCreated(result.project);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (initialDraft && initialDraft.state !== "draft") return <div className="modal-overlay"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-project-title" ref={dialogRef} tabIndex={-1}><h2 id="create-project-title">Finish publishing your saved draft</h2><p>Publishing already started. Finish or recover the existing project before making further changes.</p>{error && <p className="message error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button button-outline" disabled={busy} onClick={onClose}>Close</button><button type="button" className="button button-dark" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { const result = await api(`/project-drafts/${initialDraft._id}/publish`, { method: "POST", body: JSON.stringify({ version: initialDraft.__v }) }); onCreated(result.project); } catch (err) { setError(err.message); } finally { setBusy(false); } }}>{busy ? "Publishing…" : "Finish publishing"}</button></div></div></div>;

  return <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) requestClose(); }}>
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-project-title" ref={dialogRef} tabIndex={-1}>
      <div className="dialog-heading"><div><p className="eyebrow">{initialProject ? "EDIT PROJECT" : "NEW PROJECT"}</p><h2 id="create-project-title">{initialProject ? "Edit project brief" : "Start with a clear brief"}</h2></div><button className="icon-button" type="button" onClick={requestClose} aria-label="Close">×</button></div>
      {confirmClose && <div className="message" role="alert"><strong>Discard this project draft?</strong><p>{initialProject ? "Your saved project is unchanged. These edits have not been saved." : "These latest edits have not been saved. An earlier saved draft, if any, stays in your account."}</p><div className="dialog-actions"><button type="button" className="button button-outline" ref={keepEditingRef} onClick={() => setConfirmClose(false)}>Keep editing</button>{!initialProject && <button type="button" className="button button-outline" disabled={busy} onClick={saveForLater}>Save draft and close</button>}<button type="button" className="button button-dark" disabled={busy} onClick={onClose}>Discard draft</button></div></div>}
      {error && <p className="message error" role="alert">{error}</p>}
      {draftNotice && <p className="message" role="status">{draftNotice}</p>}
      {initialProject && <p className="dialog-intro">Existing applicants will be notified. Previous offers become stale and need a fresh agreement. Editing does not reopen closed hiring.</p>}
      <form className="stack-form" onSubmit={submit}>
        <label>Project title<input required maxLength="120" value={form.title} onChange={event => updateProject("title", event.target.value)} placeholder="e.g. Brand identity refresh" /></label>
        <label>Category<select required value={form.category} onChange={event => updateProject("category", event.target.value)}><option value="" disabled>Choose a category</option><option>Web Development</option><option>Design &amp; Creative</option><option>Writing &amp; Translation</option><option>Marketing</option><option>Data &amp; Analytics</option><option>Video &amp; Animation</option><option>Admin &amp; Support</option><option>Other</option></select></label>
        {form.category === "Other" && <label>Project field <small>Tell freelancers which field this project belongs to.</small><input required minLength="2" maxLength="80" value={form.customCategory} onChange={event => updateProject("customCategory", event.target.value)} placeholder="e.g. Architecture, Legal research, Game development" /></label>}
        <label>Project brief <small>What needs to be done and what will a successful result look like?</small><textarea required minLength="30" maxLength="3000" rows="5" value={form.description} onChange={event => updateProject("description", event.target.value)} placeholder="Describe the goals, deliverables and any important context…" /></label>
        <label>Required skills <small>Separate each skill with a comma</small><input required value={form.requiredSkills} onChange={event => updateProject("requiredSkills", event.target.value)} placeholder="React, UI design, Node.js" /></label>
        <div className="skill-suggestions"><button className="button button-outline" type="button" disabled={extractingSkills || !categoryReady || form.description.trim().length < 30} onClick={extractSkills}>{extractingSkills ? "Finding skills…" : "Suggest skills from brief"}</button><small className="form-help">Review suggestions before adding them. You can edit the skills above at any time.</small>
          {skillPreview && <section className="plan-preview" aria-label="Suggested skills"><p>{skillPreview.explanation}</p>{skillPreview.suggestions.length ? <ul className="suggested-skills-list">{skillPreview.suggestions.map(suggestion => <li key={suggestion.skill}><button className="button button-outline" type="button" disabled={skillAdded(suggestion) || parseSkills(form.requiredSkills).length >= 10} onClick={() => addSuggestedSkill(suggestion)}>{skillAdded(suggestion) ? `Added ${suggestion.skill}` : `Add ${suggestion.skill}`}</button><small>Found “{suggestion.matchedTerm}”: {suggestion.evidence}</small></li>)}</ul> : <p>No known skills found in this brief. Type the skills you need above.</p>}{(skillPreview.limited || parseSkills(form.requiredSkills).length >= 10) && <small>Projects can have up to 10 required skills. Review the list and keep the most relevant ones.</small>}</section>}
        </div>
        <div className="form-row"><label>Budget (₹)<input required type="number" step="0.01" min="1" value={form.budget} onChange={event => updateProject("budget", event.target.value)} /></label><label>Deadline<input required type="date" min={todayISO()} value={form.deadline} onChange={event => updateProject("deadline", event.target.value)} /></label></div>
        <div className="milestone-form-header"><div><strong>Milestones</strong><small>Choose which earlier steps must be approved before a step unlocks.</small></div><div className="plan-actions"><button className="text-button" type="button" disabled={suggesting || !categoryReady || form.description.trim().length < 30 || !parseSkills(form.requiredSkills).length || Number(form.budget) <= 0} onClick={() => suggestPlan("guided")}>{suggesting ? "Planning…" : "Suggest a plan"}</button><button className="text-button" type="button" disabled={suggesting || !categoryReady || !aiAvailable || !form.title.trim() || form.description.trim().length < 30 || !parseSkills(form.requiredSkills).length || Number(form.budget) < 1} onClick={() => suggestPlan("ai")}>Draft with AI</button><button className="text-button" type="button" disabled={form.milestones.length >= 20} onClick={() => setForm(current => ({ ...current, milestones: [...current.milestones, freshStep(current.milestones.length)] }))}>+ Add step</button></div></div>
        <p className="ai-plan-note">{aiAvailable ? `Optional: Draft with AI sends your project title, brief, skills, budget, deadline and project category/field to ${aiStatus?.providerName || "OpenAI"} only when you click. Remove personal information first. ${aiStatus?.dataNotice || ""} Review the draft before using it.` : "AI draft is unavailable in this demo. The guided draft works without an AI key."}</p>
        {aiPlanFailed && <div className="message" role="status"><p>Your milestones are unchanged. You can use the guided draft while AI is unavailable.</p><button className="button button-outline" type="button" disabled={suggesting} onClick={() => suggestPlan("guided")}>Use guided fallback</button></div>}
        {preview && preview.signature === planSignature(form) && <div className="plan-preview" role="region" aria-label="Suggested milestone plan"><div><strong>{preview.method === "ai_assisted" ? "AI-assisted draft" : "Guided draft"}</strong><p>{preview.explanation}</p></div><ol>{preview.suggestions.map((step, index) => <li key={index}><strong>{step.title}</strong><span>₹{Number(step.payment).toLocaleString("en-IN")} planned</span><small>{step.description}</small><small>{step.dependsOn.length ? `After step${step.dependsOn.length > 1 ? "s" : ""} ${step.dependsOn.map(number => number + 1).join(" and ")}` : "Available from the start"}</small></li>)}</ol><button className="button button-outline" type="button" onClick={useSuggestedPlan}>Use this draft for milestones</button><p>This replaces the current milestone plan. You can edit every step before publishing.</p></div>}
        {form.milestones.map((step, index) => <div className="milestone-input" key={index}>
          <div className="milestone-input-head"><strong>Step {index + 1}</strong>{form.milestones.length > 1 && <button className="text-button danger" type="button" onClick={() => removeStep(index)}>Remove</button>}</div>
          <label>Title<input required value={step.title} onChange={event => updateStep(index, { title: event.target.value })} placeholder="e.g. Initial concepts" /></label>
          <label>Target date (optional)<input type="date" min={todayISO()} max={form.deadline || undefined} value={step.dueDate} onChange={event => updateStep(index, { dueDate: event.target.value })} /></label>
          <div className="form-row"><label>Description<input value={step.description} onChange={event => updateStep(index, { description: event.target.value })} placeholder="What should be delivered?" /></label><label>Planned amount (₹)<input type="number" step="0.01" min="0" value={step.payment} onChange={event => updateStep(index, { payment: event.target.value })} /></label></div>
          {index > 0 && <fieldset className="dependency-picker"><legend>Unlock after</legend><div>{form.milestones.slice(0, index).map((prior, priorIndex) => <label key={priorIndex}><input type="checkbox" checked={step.dependsOn.includes(priorIndex)} onChange={() => toggleDependency(index, priorIndex)} />Step {priorIndex + 1}{prior.title ? ` · ${prior.title}` : ""}</label>)}</div><small>Leave all unchecked to make this step available from the start.</small></fieldset>}
        </div>)}
        <p className="form-help">Amounts are for planning only. Payments are not processed by this app.</p>
        <div className="dialog-actions"><button className="button button-outline" type="button" disabled={busy} onClick={requestClose}>Cancel</button>{!initialProject && <button className="button button-outline" type="button" disabled={busy || Boolean(draftRef.current && draftRef.current.state !== "draft")} onClick={saveForLater}>Save draft and close</button>}<button className="button button-dark" disabled={busy}>{busy ? "Saving…" : initialProject ? "Save project changes" : "Publish project ↗"}</button></div>
      </form>
    </div>
  </div>;
}
