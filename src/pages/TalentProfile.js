import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import Shell from "../components/Shell";

export default function TalentProfile() {
  const { freelancerId } = useParams();
  const [person, setPerson] = useState(null);
  const [projects, setProjects] = useState([]);
  const [sent, setSent] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([api(`/talent/${freelancerId}`), api("/projects/mine"), api("/invitations/sent")])
      .then(([profile, owned, invitations]) => {
        if (!active) return;
        setPerson(profile);
        setProjects(owned.filter(project => project.status === "Open"));
        setSent(invitations);
        setError("");
      })
      .catch(err => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [freelancerId]);

  const available = projects.filter(project => !sent.some(invite => String(invite.project) === project._id && String(invite.freelancer) === freelancerId));
  const selectedProject = available.some(project => project._id === projectId) ? projectId : available[0]?._id || "";

  async function invite(event) {
    event.preventDefault();
    if (!selectedProject) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api("/invitations", { method: "POST", body: JSON.stringify({ projectId: selectedProject, freelancerId, note: note.trim() }) });
      setSent(current => [...current, { _id: result.id, project: selectedProject, freelancer: freelancerId, status: result.status }]);
      setProjectId(""); setNote(""); setNotice(`Invitation sent to ${person.name}.`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <Shell role="client" eyebrow="FREELANCER PROFILE" title={person?.name || "Freelancer profile"} subtitle={person?.headline || "Review experience and verified work before inviting."} action={<Link className="button button-outline" to="/talent">← Find talent</Link>}>
    {loading && <p className="empty-state" role="status">Loading profile…</p>}
    {error && <p className="message error" role="alert">{error}</p>}
    {notice && <p className="message success" role="status">{notice}</p>}
    {person && <div className="talent-profile-layout"><div className="talent-profile-main">
      <section className="panel talent-profile-section"><p className="eyebrow">ABOUT</p><h2>{person.headline}</h2><p className="talent-profile-bio">{person.bio}</p><div className="skill-list">{person.skills.map(skill => <span className="skill-chip" key={skill}>{skill}</span>)}</div>{person.portfolioUrl && <a href={person.portfolioUrl} target="_blank" rel="noreferrer">Visit external portfolio ↗</a>}</section>
      <section className="panel talent-profile-section"><p className="eyebrow">CLIENT REVIEWS</p><h2>{person.reviews.count ? `★ ${person.reviews.average}/5 from ${person.reviews.count} reviews` : "No published reviews yet"}</h2>{person.reviews.items.length ? person.reviews.items.map((review, index) => <article className="talent-profile-review" key={`${review.createdAt}-${index}`}><strong>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</strong><p>{review.text}</p><time dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleDateString("en-IN")}</time></article>) : <p>Reviews appear after both project partners submit feedback.</p>}</section>
    </div><aside className="talent-profile-aside"><section className="panel talent-profile-section"><p className="eyebrow">WORK HISTORY</p><div className="talent-profile-stats"><div><strong>{person.experienceYears}</strong><span>Years experience</span><small>Self-reported</small></div><div><strong>{person.trust?.score == null ? "New" : `${person.trust.score}/100`}</strong><span>Verified work score</span><small>{person.trust?.approvedMilestones || 0} approved milestones</small></div><div><strong>{person.trust?.completedProjects || 0}</strong><span>Completed projects</span></div></div></section>
      <section className="panel talent-profile-section"><p className="eyebrow">START A CONVERSATION</p><h2>Invite to a project</h2>{available.length ? <form className="stack-form" onSubmit={invite}><label>Open project<select value={selectedProject} onChange={event => setProjectId(event.target.value)}>{available.map(project => <option value={project._id} key={project._id}>{project.title}</option>)}</select></label><label>Personal invitation<textarea required minLength="10" maxLength="1000" rows="5" value={note} onChange={event => setNote(event.target.value)} placeholder="Explain why this project fits their skills…" /></label><button className="button button-dark" disabled={busy || note.trim().length < 10}>{busy ? "Sending…" : "Send invitation →"}</button></form> : <p>{projects.length ? "This freelancer has already been invited to all your open projects." : "Post an open project before inviting this freelancer."} {!projects.length && <Link to="/client-dashboard">Go to my projects →</Link>}</p>}</section>
    </aside></div>}
    {person && <section className="panel talent-profile-section talent-profile-extra"><p className="eyebrow">AVAILABILITY &amp; PORTFOLIO</p><div className="talent-extra-facts"><div><span>Availability</span><strong>{({ available: "Available for work", limited: "Limited availability", unavailable: "Not available" })[person.availability] || "Not set"}</strong></div>{person.hourlyRate != null && <div><span>Stated hourly rate</span><strong>₹{Number(person.hourlyRate).toLocaleString("en-IN")}/hr</strong></div>}</div>{person.portfolioItems?.length > 0 ? <div className="talent-portfolio-detail">{person.portfolioItems.map((item, index) => <article key={`${item.url}-${index}`}><h3>{item.title}</h3>{item.description && <p>{item.description}</p>}<a href={item.url} target="_blank" rel="noreferrer">Open external work ↗</a></article>)}</div> : <p>No portfolio items have been added.</p>}</section>}
  </Shell>;
}
