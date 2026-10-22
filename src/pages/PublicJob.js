import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, currentUser } from "../api";
import { projectCategoryLabel } from "../projectCategory";

const money = value => `₹${Number(value || 0).toLocaleString("en-IN")}`;

export default function PublicJob() {
  const { projectId } = useParams();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const user = currentUser();

  useEffect(() => {
    let active = true;
    setLoading(true);
    api(`/projects/public/${projectId}`)
      .then(data => { if (active) { setJob(data); setError(""); } })
      .catch(err => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  const applyLink = user?.role === "freelancer" ? `/freelancer-dashboard?project=${projectId}` : `/login?role=freelancer&project=${projectId}`;

  return <div className="public-job-page">
    <header className="site-header marketplace-header"><Link className="brand" to="/"><span className="brand-mark">✦</span><span>Freelance<span className="brand-light">Chain</span></span></Link><nav><Link to="/#open-projects">← Browse projects</Link><Link className="button button-dark header-cta" to={user?.role === "client" ? "/client-dashboard" : applyLink}>{user?.role === "client" ? "My workspace" : "Find work"}</Link></nav></header>
    <main className="public-job-main">
      <Link className="public-job-back" to="/#open-projects">← All open projects</Link>
      {loading && <div className="market-result-state" role="status">Loading project brief…</div>}
      {error && !loading && <div className="market-result-state" role="alert"><h1>Project unavailable</h1><p>{error}</p><Link to="/#open-projects">Browse open projects</Link></div>}
      {job && !loading && <div className="public-job-layout"><div className="public-job-detail">
        <p className="eyebrow">{projectCategoryLabel(job)} · OPEN FOR PROPOSALS</p><h1>{job.title}</h1><p className="public-job-date">Posted {new Date(job.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</p>
        <section><h2>About the project</h2><p className="public-job-description">{job.description}</p></section>
        {(job.company?.name || job.company?.overview) && <section><h2>About the client</h2>{job.company.name && <p className="public-company-name">{job.company.name}</p>}{job.company.overview && <p className="public-job-description">{job.company.overview}</p>}</section>}
        <section><h2>Skills requested</h2><div className="market-job-skills">{job.requiredSkills.length ? job.requiredSkills.map(skill => <span key={skill}>{skill}</span>) : <p>No specific skills listed.</p>}</div></section>
        <section><h2>Planned milestones</h2><ol className="public-job-milestones">{job.milestones.map(item => <li key={item.id}><div><strong>{item.title}</strong><span>{money(item.payment)}</span></div>{item.description && <p>{item.description}</p>}{item.dueDate && <p>Target date: {item.dueDate}</p>}</li>)}</ol></section>
      </div><aside className="public-job-side"><span className="market-job-status"><i /> Open for proposals</span><div><small>Project budget</small><strong>{money(job.budget)}</strong></div><div><small>Target date</small><strong>{job.deadline ? new Date(`${job.deadline}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "To be agreed"}</strong></div>{user?.role === "client" ? <p>To send a proposal, use a freelancer account.</p> : <Link className="button button-dark" to={applyLink}>{user?.role === "freelancer" ? "Write a proposal →" : "Sign in to apply →"}</Link>}<p>Review the brief and milestones before sending your proposal.</p></aside></div>}
    </main>
  </div>;
}
