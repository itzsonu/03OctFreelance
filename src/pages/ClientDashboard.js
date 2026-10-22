import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import Shell from "../components/Shell";
import ProjectForm from "../components/ProjectForm";
import ApplicantsDialog from "../components/ApplicantsDialog";
import DeliveryOutlook from "../components/DeliveryOutlook";
import useLiveUpdates from "../useLiveUpdates";

const money = value => `₹${Number(value || 0).toLocaleString("en-IN")}`;

export default function ClientDashboard() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [company, setCompany] = useState({ name: "", overview: "" });
  const [companyBusy, setCompanyBusy] = useState(false);

  async function load() {
    try { setProjects(await api("/projects/mine")); setError(""); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { api("/profile/me").then(data => setCompany({ name: data.company?.name || "", overview: data.company?.overview || "" })).catch(err => setError(err.message)); }, []);
  const liveStatus = useLiveUpdates(event => { if (["project", "applications", "reconnected"].includes(event.type)) load(); });

  async function saveCompany(event) {
    event.preventDefault(); setCompanyBusy(true); setError(""); setNotice("");
    try {
      const result = await api("/profile/me", { method: "PUT", body: JSON.stringify({ companyName: company.name, companyOverview: company.overview }) });
      setCompany({ name: result.company?.name || "", overview: result.company?.overview || "" });
      setNotice("Company information saved.");
    } catch (err) { setError(err.message); }
    finally { setCompanyBusy(false); }
  }

  const active = projects.filter(project => project.status === "In Progress").length;
  const activeProjects = projects.filter(project => project.status === "In Progress");
  const waiting = projects.filter(project => project.status === "In Progress").reduce((total, project) => total + (project.milestones || []).filter(milestone => milestone.status === "submitted").length, 0);
  const attention = projects.filter(project => ["urgent", "attention"].includes(project.insights?.level))
    .sort((a, b) => (a.insights.level === "urgent" ? -1 : 0) - (b.insights.level === "urgent" ? -1 : 0));

  return <Shell role="client" eyebrow="CLIENT WORKSPACE" title="Your projects, at a glance." subtitle="Plan the work, review applicants and keep milestones moving." action={<button className="button button-dark" onClick={() => setCreating(true)}>+ New project</button>}>
    {notice && <div className="message success" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}
    {error && <div className="message error" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
    <div className="metrics-grid"><div className="metric-card"><span>Total projects</span><strong>{projects.length}</strong><small>In your workspace</small><span className="metric-icon">▦</span></div><div className="metric-card"><span>In progress</span><strong>{active}</strong><small>With an assigned freelancer</small><span className="metric-icon">↗</span></div><div className="metric-card"><span>Awaiting review</span><strong>{waiting}</strong><small>Milestones submitted</small><span className="metric-icon">✓</span></div></div>
    <section className="panel company-settings"><div className="panel-heading"><div><p className="eyebrow">CLIENT IDENTITY</p><h2>Company information</h2><p>Shown on your open public project briefs.</p></div></div><form className="company-settings-form" onSubmit={saveCompany}><label>Company name<input maxLength="100" value={company.name} onChange={event => setCompany(current => ({ ...current, name: event.target.value }))} placeholder="Optional" /></label><label>Overview<textarea rows="3" maxLength="1000" value={company.overview} onChange={event => setCompany(current => ({ ...current, overview: event.target.value }))} placeholder="A short introduction freelancers can use to understand your organization." /></label><button className="button button-outline" disabled={companyBusy}>{companyBusy ? "Saving…" : "Save company details"}</button></form></section>
    {!loading && <section className="panel pulse-panel"><div className="panel-heading"><div><p className="eyebrow">PROJECT PULSE</p><h2>What needs attention</h2></div><span className="count-pill">{attention.length} {attention.length === 1 ? "project" : "projects"}</span></div>{attention.length ? <div className="pulse-grid">{attention.map(project => <article className={`pulse-card pulse-${project.insights.level}`} key={project._id}><div><span className={`pulse-level pulse-${project.insights.level}`}>{project.insights.level === "urgent" ? "Deadline passed" : "Needs attention"}</span><strong>{project.insights.percent}% approved</strong></div><h3><Link to={`/milestones/${project._id}`}>{project.title}</Link></h3><ul>{project.insights.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul><Link className="pulse-link" to={`/milestones/${project._id}`}>Open project →</Link></article>)}</div> : <p className="pulse-clear">No active project needs attention right now.</p>}</section>}
    {!loading && activeProjects.some(project => project.outlook) && <section className="panel outlook-panel" aria-label="Delivery outlook"><div className="panel-heading"><div><p className="eyebrow">DELIVERY OUTLOOK</p><h2>How the work is moving</h2><p className="outlook-intro">A rough estimate from approved milestone timing and recorded activity. This is not an AI prediction or a guarantee.</p></div><span className="count-pill">{activeProjects.length} active</span></div><div className="outlook-grid">{activeProjects.map(project => <DeliveryOutlook key={project._id} project={project} linked />)}</div></section>}
    <section className="panel project-panel"><div className="panel-heading"><div><p className="eyebrow">PROJECTS</p><h2>Manage your work</h2></div><div className="live-heading">{liveStatus === "live" && <span className="live-pill">Live updates</span>}{liveStatus === "reconnecting" && <span className="live-pill reconnecting">Reconnecting…</span>}<span className="count-pill">{projects.length} total</span></div></div>{loading ? <p className="empty-state">Loading projects…</p> : projects.length === 0 ? <div className="empty-state"><span>▣</span><h3>Your first project starts here</h3><p>Share a project brief, skills, budget and milestones. Freelancers can then apply.</p><button className="button button-dark" onClick={() => setCreating(true)}>Create a project ↗</button></div> : <div className="project-table">{projects.map(project => {
      const approved = (project.milestones || []).filter(milestone => milestone.status === "completed").length;
      const total = project.milestones?.length || 0;
      return <article className="project-table-row" key={project._id}><div className="project-main"><div className="project-initial">{project.title?.[0]?.toUpperCase()}</div><div><Link className="project-name" to={`/milestones/${project._id}`}>{project.title}</Link><small>{project.freelancer?.name ? `With ${project.freelancer.name}` : project.status === "Open" ? "Looking for a freelancer" : "Hiring closed"} · Due {project.deadline}</small><div className="skill-list compact">{(project.requiredSkills || []).slice(0, 3).map(skill => <span className="skill-chip" key={skill}>{skill}</span>)}</div></div></div><div className="project-progress"><span>{approved} of {total} milestones</span><div className="progress-track"><span style={{ width: `${total ? approved / total * 100 : 0}%` }} /></div></div><div className="project-amount">{money(project.budget)}</div><span className={`status status-${project.status.toLowerCase().replaceAll(" ", "-")}`}>{project.status}</span><div className="row-actions">{["Open", "Closed"].includes(project.status) && !project.freelancer && <button className="text-button" onClick={() => setEditing(project)}>Edit project</button>}<button className="text-button" onClick={() => setSelected(project)}>Applicants</button><Link className="row-arrow" to={`/milestones/${project._id}`} aria-label={`View ${project.title}`}>↗</Link></div></article>;
    })}</div>}</section>
    {editing && <ProjectForm initialProject={editing} onClose={() => setEditing(null)} onCreated={() => { setEditing(null); setNotice("Project updated. Previous offers need a fresh agreement."); load(); }} />}
    {creating && <ProjectForm onClose={() => setCreating(false)} onCreated={() => { setCreating(false); setNotice("Project published. Freelancers can now apply."); load(); }} />}
    {selected && <ApplicantsDialog project={selected} onClose={() => setSelected(null)} onDecision={action => { setNotice(action === "agreed" ? "Terms agreed and freelancer assigned to the project." : "Application declined."); load(); }} />}
  </Shell>;
}
