import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import Shell from "../components/Shell";
import Pagination from "../components/Pagination";
import usePagedList from "../usePagedList";
import useDialogAccessibility from "../useDialogAccessibility";

export default function TalentDirectory() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryString = searchParams.toString();
  const query = searchParams.get("q") || "";
  const skill = searchParams.get("skill") || "";
  const minExperience = searchParams.get("minExperience") || "";
  const maxExperience = searchParams.get("maxExperience") || "";
  const availability = searchParams.get("availability") || "";
  const history = searchParams.get("history") || "";
  const sort = searchParams.get("sort") || "newest";
  const page = Number(searchParams.get("page") || 1);
  const [draft, setDraft] = useState(query);
  const [talent, setTalent] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const owned = usePagedList("/projects/mine?view=invitable");
  const openProjects = owned.items;
  const [sent, setSent] = useState([]);
  const [invitePerson, setInvitePerson] = useState(null);
  const [inviteProject, setInviteProject] = useState("");
  const [inviteNote, setInviteNote] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const inviteDialogRef = useDialogAccessibility(() => setInvitePerson(null), Boolean(invitePerson));

  useEffect(() => { setDraft(query); }, [query]);

  useEffect(() => {
    api("/invitations/sent")
      .then(invitations => { setSent(invitations); })
      .catch(err => setError(err.message));
  }, []);

  useEffect(() => {
    let current = true;
    const params = new URLSearchParams(queryString);
    params.set("page", String(page));
    setLoading(true);
    api(`/talent?${params}`)
      .then(data => { if (current) { setTalent(data.talent || []); setTotal(data.total || 0); setPages(data.pages || Math.ceil((data.total || 0) / 12)); setError(""); } })
      .catch(err => { if (current) setError(err.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [queryString, query, page]);

  function updateFilters(changes, resetPage = true) {
    const next = new URLSearchParams(queryString);
    Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    if (resetPage) next.delete("page");
    setSearchParams(next);
  }

  function clearFilters() {
    setDraft("");
    setSearchParams({}, { replace: true });
  }

  function search(event) {
    event.preventDefault();
    updateFilters({ q: draft.trim() });
  }

  function openInvite(person) {
    const available = openProjects.filter(project => !sent.some(invite => String(invite.project) === project._id && String(invite.freelancer) === person.id));
    setInvitePerson(person);
    setInviteProject(available[0]?._id || "");
    setInviteNote("");
    setInviteError("");
  }

  async function sendInvite(event) {
    event.preventDefault();
    const chosenProject = inviteOptions.some(item => item._id === inviteProject) ? inviteProject : inviteOptions[0]?._id;
    if (!invitePerson || !chosenProject) return;
    setInviteBusy(true); setInviteError("");
    try {
      const result = await api("/invitations", { method: "POST", body: JSON.stringify({ projectId: chosenProject, freelancerId: invitePerson.id, note: inviteNote.trim() }) });
      setSent(current => [...current, { _id: result.id, project: chosenProject, freelancer: invitePerson.id, status: result.status }]);
      setNotice(`Invitation sent to ${invitePerson.name}.`);
      setInvitePerson(null);
    } catch (err) { setInviteError(err.message); }
    finally { setInviteBusy(false); }
  }

  const inviteOptions = invitePerson ? openProjects.filter(project => !sent.some(invite => String(invite.project) === project._id && String(invite.freelancer) === invitePerson.id)) : [];

  return <Shell role="client" eyebrow="FIND TALENT" title="Find the right freelancer." subtitle="Explore professionals who chose to make their profiles visible to clients." action={<Link className="button button-dark" to="/client-dashboard">My projects ↗</Link>}>
    {notice && <div className="message success" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}
    <section className="panel talent-panel"><div className="panel-heading"><div><p className="eyebrow">TALENT DIRECTORY</p><h2>Discover freelancers</h2></div><span className="count-pill">{total} visible profiles</span></div>
      <form className="market-discovery-filters talent-filters" role="search" aria-label="Filter freelancer profiles" onSubmit={search}><label>Search<input id="talent-query" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Name, headline or skill" /></label><label>Skill<input value={skill} onChange={event => updateFilters({ skill: event.target.value })} placeholder="Exact skill" /></label><label>Minimum experience<input type="number" min="0" max="60" value={minExperience} onChange={event => updateFilters({ minExperience: event.target.value })} placeholder="Any" /></label><label>Maximum experience<input type="number" min="0" max="60" value={maxExperience} onChange={event => updateFilters({ maxExperience: event.target.value })} placeholder="Any" /></label><label>Platform work history<select value={history} onChange={event => updateFilters({ history: event.target.value })}><option value="">All profiles</option><option value="none">No approved work yet</option><option value="recorded">Has approved work</option></select></label><label>Availability<select value={availability} onChange={event => updateFilters({ availability: event.target.value })}><option value="">Any availability</option><option value="available">Available</option><option value="limited">Limited</option><option value="unavailable">Unavailable</option></select></label><label>Sort<select value={sort} onChange={event => updateFilters({ sort: event.target.value })}><option value="newest">Recently joined</option><option value="name">Name A–Z</option><option value="experience-high">Most experience</option><option value="experience-low">Least experience</option><option value="rate-high">Highest rate</option><option value="rate-low">Lowest rate</option></select></label><button className="button button-dark">Apply search</button>{(query || skill || minExperience || maxExperience || availability || history || sort !== "newest") && <button type="button" className="button button-outline" onClick={clearFilters}>Clear filters</button>}</form>
      {history === "none" && <p className="new-talent-note">These freelancers have no approved work on FreelanceChain yet. They may have experience elsewhere. Compare their skills, proposal and samples before agreeing terms.</p>}<p className="talent-results-count">{loading ? "Loading profiles…" : `Showing ${total ? (page - 1) * 12 + 1 : 0}–${Math.min(page * 12, total)} of ${total} visible profiles`}</p>
      {error && <p className="message error" role="alert">{error}</p>}
      {loading ? <p className="empty-state" role="status">Loading talent…</p> : talent.length ? <div className="talent-grid">{talent.map(person => <article className="talent-card" key={person.id}><div className="talent-card-top"><div className="talent-avatar" aria-hidden="true">{person.name?.[0]?.toUpperCase() || "F"}</div><div><h3><Link to={`/talent/${person.id}`}>{person.name}</Link></h3><p>{person.headline}</p>{person.trust?.score == null && <span className="new-talent-label">New on FreelanceChain</span>}</div></div><p className="talent-bio">{person.bio}</p><div className="skill-list">{person.skills.map(item => <span className="skill-chip" key={item}>{item}</span>)}</div><div className="talent-facts"><span><strong>{person.experienceYears}</strong> years experience <small>Self-reported</small></span><span><strong>{({ available: "Available", limited: "Limited", unavailable: "Unavailable" })[person.availability] || "Availability not set"}</strong> availability <small>Profile provided</small></span>{person.hourlyRate != null && <span><strong>₹{Number(person.hourlyRate).toLocaleString("en-IN")}/hr</strong> stated rate <small>Freelancer-provided</small></span>}<span><strong>{person.trust?.score == null ? "Unscored" : `${person.trust.score}/100`}</strong> verified work score <small>{person.trust?.score == null ? "No approved work yet" : `${person.trust.approvedMilestones} approved milestones`}</small></span></div>{person.portfolioItems?.length > 0 && <div className="talent-card-portfolio"><strong>Portfolio</strong>{person.portfolioItems.slice(0, 2).map((item, index) => <a key={`${item.url}-${index}`} href={item.url} target="_blank" rel="noreferrer">{item.title} ↗</a>)}</div>}{person.reviews?.count > 0 && <div className="talent-review-score">★ {person.reviews.average}/5 · {person.reviews.count} {person.reviews.count === 1 ? "review" : "reviews"} from completed projects</div>}<div className="talent-card-footer">{person.portfolioUrl ? <a href={person.portfolioUrl} target="_blank" rel="noreferrer">View portfolio ↗</a> : <span>Portfolio not added</span>}{openProjects.length ? <button type="button" onClick={() => openInvite(person)}>Invite to project →</button> : <Link to="/client-dashboard">Post a project →</Link>}</div></article>)}</div> : <div className="empty-state"><span>⌕</span><h3>No profiles found</h3><p>{query || skill || minExperience || maxExperience || availability || history ? "Try broadening your filters or search terms." : "Freelancers will appear here when they choose to show their profile to clients."}</p>{(query || skill || minExperience || maxExperience || availability || history) && <button className="button button-outline" onClick={clearFilters}>Clear filters</button>}</div>}
      {pages > 1 && <div className="talent-pagination"><button className="button button-outline" disabled={page === 1} onClick={() => updateFilters({ page: String(page - 1) }, false)}>← Previous</button><span>Page {page} of {pages}</span><button className="button button-outline" disabled={page >= pages} onClick={() => updateFilters({ page: String(page + 1) }, false)}>Next →</button></div>}
    </section>
    {invitePerson && <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setInvitePerson(null); }}><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="invite-title" ref={inviteDialogRef} tabIndex={-1}><div className="dialog-heading"><div><p className="eyebrow">INVITE FREELANCER</p><h2 id="invite-title">Invite {invitePerson.name}</h2></div><button className="icon-button" onClick={() => setInvitePerson(null)} aria-label="Close">×</button></div>{owned.error && <p className="message error" role="alert">{owned.error}</p>}<Pagination {...owned} onPage={owned.setPage} label="open projects" />{inviteOptions.length ? <form className="stack-form" onSubmit={sendInvite}><label>Project<select required value={inviteOptions.some(item => item._id === inviteProject) ? inviteProject : inviteOptions[0]?._id || ""} onChange={event => setInviteProject(event.target.value)}>{inviteOptions.map(project => <option value={project._id} key={project._id}>{project.title}</option>)}</select></label><label>Personal message<textarea required minLength="10" maxLength="1000" rows="5" value={inviteNote} onChange={event => setInviteNote(event.target.value)} placeholder="Tell the freelancer why this project fits their experience…" /></label><p className="form-help">The freelancer can review the project and choose whether to send a proposal.</p>{inviteError && <p className="message error" role="alert">{inviteError}</p>}<div className="dialog-actions"><button type="button" className="button button-outline" onClick={() => setInvitePerson(null)}>Cancel</button><button className="button button-dark" disabled={inviteBusy || inviteNote.trim().length < 10}>{inviteBusy ? "Sending…" : "Send invitation ↗"}</button></div></form> : <div className="empty-state"><h3>Already invited</h3><p>No available projects on this page. Browse another page or create a new project.</p><button className="button button-outline" onClick={() => setInvitePerson(null)}>Close</button></div>}</div></div>}
  </Shell>;
}

