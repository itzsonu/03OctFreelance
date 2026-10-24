import React, { useEffect, useState } from "react";
import { api } from "../api";
import "./AiComparisonDemo.css";

export default function AiComparisonDemo() {
  const [open, setOpen] = useState(false);
  const [sample, setSample] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || sample) return;
    let active = true;
    api("/applications/ai-demo").then(data => { if (active) setSample(data); }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [open, sample]);
  async function compare() {
    setBusy(true); setError("");
    try { setResult(await api("/applications/ai-demo", { method: "POST", body: "{}" })); }
    catch (err) { setResult(null); setError(err.message); }
    finally { setBusy(false); }
  }
  const ranks = new Map((result?.ranking || []).map(item => [item.applicationId, item]));
  const applicants = [...(sample?.applicants || [])].sort((a, b) => result ? ranks.get(a._id).rank - ranks.get(b._id).rank : b.match.score - a.match.score);
  return <section className="panel ai-demo" aria-label="AI comparison sample demo">
    <div className="panel-heading"><div><p className="eyebrow">EXPLORE AI MATCHING</p><h2>See how applicant comparison works</h2><p>Three fictional profiles, one writing brief. No applications or hiring decisions are created.</p></div><button className="button button-outline" type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "Hide sample demo" : "Open sample demo"}</button></div>
    {open && <div className="ai-demo-body">
      {error && <p className="message error" role="alert">{error}</p>}
      {!sample && !error && <p role="status">Loading sample profiles…</p>}
      {sample && <>
        <span className="status">FICTIONAL SAMPLE DATA</span><h3>{sample.project.title}</h3><p>{sample.project.description}</p>
        <p><strong>Field:</strong> {sample.project.category} · <strong>Required:</strong> {sample.project.requiredSkills.join(", ")}</p>
        <p>Regular fit uses listed skills, experience and brief context. These samples have no verified platform history.</p>
        <p>AI score = 60% text similarity + 40% regular fit, rounded to a whole number. A score is a comparison aid, not a probability of success.</p>
        {sample.available ? <><p>Only this fixed fictional brief and these three profiles are sent to {sample.providerName}. Your project, profile and real applicants are not sent by this demo.</p><button className="button button-dark" type="button" disabled={busy || Boolean(result)} onClick={compare}>{busy ? "Comparing samples…" : result ? "Sample comparison complete" : "Compare sample profiles with AI"}</button></> : <p role="status">AI is unavailable. Regular sample fit scores are still shown below.</p>}
        {sample.dataNotice && <p className="form-help">{sample.dataNotice}</p>}
        {error && <p role="status">Regular sample scores remain available. No AI ranking has been substituted.</p>}
        {result && <p className="message success" role="status">{result.cached ? "Saved AI result from the last 10 minutes" : "AI comparison finished"} · {result.model} · {new Date(result.generatedAt).toLocaleString()}. This demonstration does not measure real-world matching accuracy.</p>}
        <div className="ai-demo-grid">{applicants.map(item => {
          const ai = ranks.get(item._id);
          return <article className="ai-demo-card" key={item._id}><h3>{item.label}</h3><p>{item.freelancer.profile.headline}</p>{ai ? <div className="ai-demo-score"><strong>AI rank #{ai.rank} · {ai.score}/100</strong><span>Text similarity {ai.semanticScore}/100 · Regular fit {ai.ruleScore}/100</span><small>round({ai.semanticScore} × 0.6 + {ai.ruleScore} × 0.4) = {ai.score}</small></div> : <strong>Regular fit: {item.match.score}/100</strong>}<p><strong>Listed skills:</strong> {item.freelancer.profile.skills.join(", ")}</p><p><strong>Missing required skills:</strong> {item.match.missingSkills.join(", ") || "None"}</p><p>{item.proposal}</p><details><summary>Sample profile details</summary><p>{item.freelancer.profile.bio}</p><p>{item.freelancer.profile.experienceYears} years of fictional experience · No verified work</p></details></article>;
        })}</div>
        <p className="form-help">The technical subject alone does not make this a development job. Review the requested deliverable and full proposals. These authored examples are not an independently labelled evaluation dataset.</p>
      </>}
    </div>}
  </section>;
}
