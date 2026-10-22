import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { projectCategoryLabel } from "../projectCategory";

export default function RecommendedProjects({ refresh, onOpen }) {
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    api(`/projects/recommended?page=${page}&pageSize=3`).then(result => {
      if (!active) return;
      if (page > Math.max(1, result.pages || 0)) { setPage(Math.max(1, result.pages || 0)); return; }
      setData(result);
    }).catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, retry, refresh]);
  return <section className="panel recommended-projects" aria-label="Projects for your profile">
    <div className="panel-heading"><div><p className="eyebrow">YOUR NEXT STEP</p><h2>Projects for your profile</h2><p>Suggestions use your saved skills and preferred work. No platform reviews needed.</p></div><Link className="button button-outline" to="/profile">{data?.setup?.ready ? "Edit preferences" : "Set up my profile"} →</Link></div>
    {loading ? <p className="recommendation-state" role="status">Finding projects for your profile…</p> : error ? <div className="recommendation-state"><p>Suggestions could not load. You can still browse all open projects below.</p><button className="text-button" onClick={() => setRetry(value => value + 1)}>Retry suggestions</button></div> : <>
      {data?.setup && !data.setup.ready && <p className="setup-nudge">Saved profile: {data.setup.completed} of {data.setup.total} essentials ready. <Link to="/profile">Add the next detail →</Link></p>}
      {data?.availability === "unavailable" && <p className="setup-nudge">Your profile says you are unavailable. <Link to="/profile#profile-preferences">Update availability when you are ready.</Link></p>}
      {data?.projects?.length ? <div className="recommended-grid">{data.projects.map(project => <article className="recommended-card" key={project._id}>
        <small>{projectCategoryLabel(project)}</small><h3>{project.title}</h3>
        <p className="recommendation-reason">{project.reason?.matchedSkills?.length ? `Skills in common: ${project.reason.matchedSkills.join(", ")}` : "In a preferred field. Review the required skills before applying."}{project.reason?.matchedSkills?.length > 0 && project.reason?.preferredField ? " · Preferred field" : ""}</p>
        <p className="recommended-brief">{project.description}</p><strong>₹{Number(project.budget).toLocaleString("en-IN")}</strong><small>Target: {project.deadline}</small>
        <button className="button button-outline" onClick={() => onOpen(project)}>Read suggested brief →</button>
      </article>)}</div> : <div className="recommendation-state"><h3>{data?.mode === "setup" ? "Tell us what kind of work you do" : "No matching open projects right now"}</h3><p>{data?.mode === "setup" ? "Add a skill or choose a preferred field to get relevant suggestions. All open projects are still available below." : "Try updating your skills or preferred fields. You can browse other open projects below."}</p></div>}
      {data?.pages > 1 && <nav className="recommendation-pagination" aria-label="Suggested project pages"><button className="button button-outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous suggestions</button><span>{page} / {data.pages}</span><button className="button button-outline" disabled={page >= data.pages} onClick={() => setPage(value => value + 1)}>More suggestions</button></nav>}
    </>}
  </section>;
}
