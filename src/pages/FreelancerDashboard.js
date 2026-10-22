import { projectCategoryLabel } from "../projectCategory";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, currentUser } from "../api";
import Shell from "../components/Shell";
import Pagination from "../components/Pagination";
import { readPage } from "../usePagedList";
import useLiveUpdates from "../useLiveUpdates";
import useDialogAccessibility from "../useDialogAccessibility";
import ConversationPanel from "../components/ConversationPanel";
import HiringOfferPanel from "../components/HiringOfferPanel";

const money = value => `₹${Number(value || 0).toLocaleString("en-IN")}`;

export default function FreelancerDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const user = currentUser();
  const discoveryUrl = searchParams.toString();
  const query = searchParams.get("q") || "";
  const category = searchParams.get("category") || "";
  const skill = searchParams.get("skill") || "";
  const minBudget = searchParams.get("minBudget") || "";
  const maxBudget = searchParams.get("maxBudget") || "";
  const deadlineFrom = searchParams.get("deadlineFrom") || "";
  const deadlineTo = searchParams.get("deadlineTo") || "";
  const sort = searchParams.get("sort") || "newest";
  const page = Number(searchParams.get("page") || 1);
  const [queryDraft, setQueryDraft] = useState(query);
  const [projects, setProjects] = useState([]);
  const [projectPage, setProjectPage] = useState(1);
  const [applicationPage, setApplicationPage] = useState(1);
  const [projectInfo, setProjectInfo] = useState(() => readPage([]));
  const [applicationInfo, setApplicationInfo] = useState(() => readPage([]));
  const loadGeneration = useRef(0);
  const [discovered, setDiscovered] = useState([]);
  const [discoveryTotal, setDiscoveryTotal] = useState(0);
  const [discoveryPages, setDiscoveryPages] = useState(0);
  const [discoveryLoading, setDiscoveryLoading] = useState(true);
  const [discoveryError, setDiscoveryError] = useState("");
  const [discoveryRefresh, setDiscoveryRefresh] = useState(0);
  const [applications, setApplications] = useState([]);
  const [savedIds, setSavedIds] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [messageApplication, setMessageApplication] = useState(null);
  const [tab, setTab] = useState("discover");
  const [selected, setSelected] = useState(null);
  const [proposal, setProposal] = useState("");
  const [proposedPrice, setProposedPrice] = useState("");
  const [deliveryEstimateDays, setDeliveryEstimateDays] = useState("14");
  const [portfolioLinks, setPortfolioLinks] = useState("");
  const [answerQuestion, setAnswerQuestion] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [editingProposalId, setEditingProposalId] = useState(null);
  const [proposalEdits, setProposalEdits] = useState({ proposal: "", proposedPrice: "", deliveryEstimateDays: "14", portfolioLinks: "", answerQuestion: "", answerText: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const proposalDialogRef = useDialogAccessibility(() => setSelected(null), Boolean(selected));

  const load = useCallback(async () => {
    const version = {}; loadGeneration.current = version;
    setLoading(true);
    try {
      const [projectData, applicationData, savedData, invitationData] = await Promise.all([api('/projects/all?page='+projectPage+'&pageSize=12&view='+(tab === 'saved' ? 'saved' : 'assigned')), api('/applications/mine?page='+applicationPage+'&pageSize=12'), api('/projects/saved'), api('/invitations/mine')]);
      if (version !== loadGeneration.current) return;
      const projectResult = readPage(projectData, projectPage); const applicationResult = readPage(applicationData, applicationPage);
      if (projectPage > Math.max(1,projectResult.pages)) { setProjectPage(Math.max(1,projectResult.pages)); return; }
      if (applicationPage > Math.max(1,applicationResult.pages)) { setApplicationPage(Math.max(1,applicationResult.pages)); return; }
      setProjectInfo(projectResult); setApplicationInfo(applicationResult); setProjects(projectResult.items); setApplications(applicationResult.items); setSavedIds(savedData); setInvitations(invitationData); setError('');
    } catch (err) { if (version === loadGeneration.current) setError(err.message); }
    finally { if (version === loadGeneration.current) setLoading(false); }
  }, [projectPage, applicationPage, tab]);
  useEffect(() => { load(); return () => { loadGeneration.current = null; }; }, [load]);
  useEffect(() => { setQueryDraft(query); }, [query]);
  useEffect(() => {
    let current = true;
    const source = new URLSearchParams(discoveryUrl);
    const params = new URLSearchParams();
    ["q", "category", "skill", "minBudget", "maxBudget", "deadlineFrom", "deadlineTo", "sort", "page"].forEach(key => {
      const value = source.get(key);
      if (value) params.set(key, value);
    });
    setDiscoveryLoading(true);
    setDiscoveryError("");
    api(`/projects/public${params.toString() ? `?${params}` : ""}`)
      .then(data => {
        if (!current) return;
        setDiscovered(data.projects || []);
        setDiscoveryTotal(data.total || 0);
        setDiscoveryPages(data.pages || 0);
      })
      .catch(err => { if (current) setDiscoveryError(err.message); })
      .finally(() => { if (current) setDiscoveryLoading(false); });
    return () => { current = false; };
  }, [discoveryUrl, discoveryRefresh]);
  useEffect(() => {
    const projectId = searchParams.get("project");
    if (loading || !projectId) return;
    setTab('discover');
    api('/projects/public/'+projectId).then(brief => { setSelected(brief); prepareProposal(brief); }).catch(() => setNotice('This project is no longer open for proposals.'));
    const next = new URLSearchParams(searchParams);
    next.delete("project");
    setSearchParams(next, { replace: true });
  }, [loading, projects, searchParams, setSearchParams]);
  const liveStatus = useLiveUpdates(event => { if (["project", "applications", "marketplace", "reconnected"].includes(event.type)) { load(); setDiscoveryRefresh(value => value + 1); } });

  function updateDiscovery(changes, resetPage = true) {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    if (resetPage) next.delete("page");
    setSearchParams(next);
  }

  function prepareProposal(project) {
    setProposal("");
    setProposedPrice(String(project?.budget || ""));
    setDeliveryEstimateDays("14");
    setPortfolioLinks("");
    setAnswerQuestion("");
    setAnswerText("");
    setError("");
  }

  function submitDiscovery(event) {
    event.preventDefault();
    updateDiscovery({ q: queryDraft.trim() });
  }

  function clearDiscovery() {
    const next = new URLSearchParams(searchParams);
    ["q", "category", "skill", "minBudget", "maxBudget", "deadlineFrom", "deadlineTo", "sort", "page"].forEach(key => next.delete(key));
    setQueryDraft("");
    setSearchParams(next);
  }

  async function openBrief(project) {
    setError("");
    try {
      const brief = await api(`/projects/public/${project._id}`);
      setSelected(brief);
      prepareProposal(brief);
    } catch (err) { setDiscoveryError(err.message); }
  }

  async function apply(event) {
    event.preventDefault();
    if (!selected || !proposal.trim() || !proposedPrice || !deliveryEstimateDays || Boolean(answerQuestion.trim()) !== Boolean(answerText.trim())) return;
    setBusy(true); setError("");
    try {
      const answers = answerQuestion.trim() ? [{ question: answerQuestion.trim(), answer: answerText.trim() }] : [];
      await api("/applications", { method: "POST", body: JSON.stringify({ projectId: selected._id || selected.id, proposal: proposal.trim(), proposedPrice: Number(proposedPrice), deliveryEstimateDays: Number(deliveryEstimateDays), portfolioLinks: portfolioLinks.split(/\r?\n/).map(link => link.trim()).filter(Boolean), answers }) });
      setSelected(null); setProposal(""); setNotice("Proposal sent. Track terms and responses under My applications.");
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function toggleSaved(projectId) {
    const saved = savedIds.includes(projectId);
    try {
      await api(`/projects/saved/${projectId}`, { method: saved ? "DELETE" : "PUT" });
      setSavedIds(ids => saved ? ids.filter(id => id !== projectId) : [...ids, projectId]);
    } catch (err) { setError(err.message); }
  }

  async function declineInvitation(invitationId) {
    try {
      await api(`/invitations/${invitationId}/decline`, { method: "POST" });
      setNotice("Invitation declined.");
      await load();
    } catch (err) { setError(err.message); }
  }

  function editApplication(application) {
    setEditingProposalId(application._id);
    setProposalEdits({ proposal: application.proposal || "", proposedPrice: application.proposedPrice == null ? "" : String(application.proposedPrice), deliveryEstimateDays: application.deliveryEstimateDays == null ? "14" : String(application.deliveryEstimateDays), portfolioLinks: (application.portfolioLinks || []).join("\n"), answerQuestion: application.answers?.[0]?.question || "", answerText: application.answers?.[0]?.answer || "" });
    setError("");
  }

  async function saveApplicationEdit(event, application) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (Boolean(proposalEdits.answerQuestion.trim()) !== Boolean(proposalEdits.answerText.trim())) throw new Error("Complete both the optional question and answer, or leave both blank.");
      const answers = proposalEdits.answerQuestion.trim() ? [{ question: proposalEdits.answerQuestion.trim(), answer: proposalEdits.answerText.trim() }] : [];
      const result = await api(`/applications/${application._id}`, { method: "PATCH", body: JSON.stringify({ proposal: proposalEdits.proposal, proposedPrice: Number(proposalEdits.proposedPrice), deliveryEstimateDays: Number(proposalEdits.deliveryEstimateDays), portfolioLinks: proposalEdits.portfolioLinks.split(/\r?\n/).map(link => link.trim()).filter(Boolean), answers }) });
      setEditingProposalId(null); setNotice(result.invalidatedOffer ? "Proposal updated. The previous offer is now stale." : "Proposal updated."); await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function withdrawApplication(application) {
    setBusy(true); setError("");
    try { await api(`/applications/${application._id}/withdraw`, { method: "POST", body: JSON.stringify({}) }); setNotice("Proposal withdrawn."); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const open = projects.filter(project => project.status === "Open");
  const assigned = projects.filter(project => project.freelancer?._id === user?.id || project.freelancer === user?.id);
  const savedOpen = open.filter(project => savedIds.includes(project._id));
  const visibleJobs = tab === "saved" ? savedOpen : discovered;
  const pending = applicationInfo.summary?.pending ?? applications.filter(application => application.status === "PENDING").length;
  const activeInvitations = invitations.filter(invitation => invitation.status === "PENDING" && invitation.project?.status === "Open");
  const activeDiscoveryFilters = [query && `Search: ${query}`, category && `Category: ${category}`, skill && `Skill: ${skill}`, minBudget && `From ₹${Number(minBudget).toLocaleString("en-IN")}`, maxBudget && `Up to ₹${Number(maxBudget).toLocaleString("en-IN")}`, deadlineFrom && `After ${deadlineFrom}`, deadlineTo && `By ${deadlineTo}`, sort !== "newest" && `Sort: ${sort.replace("-", " ")}`].filter(Boolean);

  return <Shell role="freelancer" eyebrow="FREELANCER WORKSPACE" title="Find your next great project." subtitle="Explore open work, send a thoughtful proposal and track your progress." action={<Link className="button button-outline" to="/profile">Edit my profile ↗</Link>}>
    {notice && <div className="message success" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}
    {error && <div className="message error" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
    <div className="metrics-grid"><div className="metric-card"><span>Open projects</span><strong>{projectInfo.summary?.open ?? open.length}</strong><small>Ready for proposals</small><span className="metric-icon">↗</span></div><div className="metric-card"><span>Active work</span><strong>{projectInfo.summary?.active ?? assigned.filter(project => project.status === "In Progress").length}</strong><small>Projects assigned to you</small><span className="metric-icon">▦</span></div><div className="metric-card"><span>Pending proposals</span><strong>{pending}</strong><small>Waiting for a response</small><span className="metric-icon">✦</span></div></div>
    <section className="panel browse-panel"><div className="panel-heading"><div><p className="eyebrow">YOUR WORKSPACE</p><h2>Projects & proposals</h2></div>{liveStatus === "live" && <span className="live-pill">Live updates</span>}{liveStatus === "reconnecting" && <span className="live-pill reconnecting">Reconnecting…</span>}</div>
      <div className="tab-row" role="tablist" aria-label="Project views">
        <button role="tab" aria-selected={tab === "discover"} className={tab === "discover" ? "active" : ""} onClick={() => setTab("discover")}>Discover <span>{projectInfo.summary?.open ?? open.length}</span></button>
        <button role="tab" aria-selected={tab === "saved"} className={tab === "saved" ? "active" : ""} onClick={() => { setTab("saved"); setProjectPage(1); }}>Saved <span>{projectInfo.summary?.saved ?? savedOpen.length}</span></button>
        <button role="tab" aria-selected={tab === "invitations"} className={tab === "invitations" ? "active" : ""} onClick={() => setTab("invitations")}>Invitations <span>{activeInvitations.length}</span></button>
        <button role="tab" aria-selected={tab === "assigned"} className={tab === "assigned" ? "active" : ""} onClick={() => { setTab("assigned"); setProjectPage(1); }}>My projects <span>{projectInfo.summary?.assigned ?? assigned.length}</span></button>
        <button role="tab" aria-selected={tab === "applications"} className={tab === "applications" ? "active" : ""} onClick={() => setTab("applications")}>My applications <span>{applicationInfo.total}</span></button>
      </div>
      {(tab === "discover" || tab === "saved") && <>
        {tab === "discover" && <>
          <form className="market-discovery-filters dashboard-job-filters" aria-label="Filter open projects" onSubmit={submitDiscovery}>
            <label>Search<input value={queryDraft} onChange={event => setQueryDraft(event.target.value)} placeholder="Titles, briefs or skills" /></label>
            <label>Category<select value={category} onChange={event => updateDiscovery({ category: event.target.value })}><option value="">All categories</option><option>Web Development</option><option>Design &amp; Creative</option><option>Writing &amp; Translation</option><option>Marketing</option><option>Data &amp; Analytics</option><option>Video &amp; Animation</option><option>Admin &amp; Support</option><option>Other</option></select></label>
            <label>Skill<input value={skill} onChange={event => updateDiscovery({ skill: event.target.value })} placeholder="Exact skill" /></label>
            <label>Minimum budget<input type="number" min="0" value={minBudget} onChange={event => updateDiscovery({ minBudget: event.target.value })} placeholder="Any" /></label>
            <label>Maximum budget<input type="number" min="0" value={maxBudget} onChange={event => updateDiscovery({ maxBudget: event.target.value })} placeholder="No limit" /></label>
            <label>Deadline from<input type="date" value={deadlineFrom} onChange={event => updateDiscovery({ deadlineFrom: event.target.value })} /></label>
            <label>Deadline to<input type="date" value={deadlineTo} onChange={event => updateDiscovery({ deadlineTo: event.target.value })} /></label>
            <label>Sort<select value={sort} onChange={event => updateDiscovery({ sort: event.target.value })}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="budget-high">Highest budget</option><option value="budget-low">Lowest budget</option><option value="deadline-soon">Soonest deadline</option></select></label>
            <button className="button button-dark" type="submit">Search jobs</button>
          </form>
          <div className="discovery-meta"><p>{discoveryLoading ? "Loading projects…" : `Showing ${discoveryTotal ? (page - 1) * 12 + 1 : 0}–${Math.min(page * 12, discoveryTotal)} of ${discoveryTotal} open projects`}</p>{activeDiscoveryFilters.length > 0 && <div className="market-active-filters discovery-active-filters" aria-label="Active filters">{activeDiscoveryFilters.map(filter => <span className="market-active-filter" key={filter}>{filter}</span>)}<button type="button" className="text-button" onClick={clearDiscovery}>Clear filters</button></div>}</div>
        </>}
        {(tab === "discover" ? discoveryLoading : loading) ? <p className="empty-state" role="status">Loading projects…</p> : tab === "discover" && discoveryError ? <div className="empty-state" role="alert"><h3>Projects could not load</h3><p>Try again in a moment.</p><button className="button button-outline" onClick={() => setDiscoveryRefresh(value => value + 1)}>Try again</button></div> : visibleJobs.length === 0 ? <div className="empty-state"><span>⌕</span><h3>{tab === "saved" ? "No saved projects yet" : discoveryTotal ? "No projects on this page" : query || category || skill || minBudget || maxBudget || deadlineFrom || deadlineTo ? "No matching projects found" : "No open projects yet"}</h3><p>{tab === "saved" ? "Save an open project to keep it here while you decide." : "Try broadening your filters or check back for new opportunities."}</p>{tab === "discover" && (query || category || skill || minBudget || maxBudget || deadlineFrom || deadlineTo) && <button className="button button-outline" onClick={clearDiscovery}>Clear filters</button>}</div> : <div className="discover-grid">{visibleJobs.map(project => {
          const application = applications.find(item => item.project?._id === project._id) || (project.applicationStatus ? { status: project.applicationStatus } : null);
          const isSaved = savedIds.includes(project._id);
          return <article className="discover-card" key={project._id}>
            <div className="card-top"><span className="status status-open">Open for proposals</span><button className="save-job" aria-pressed={isSaved} onClick={() => toggleSaved(project._id)}>{isSaved ? "★ Saved" : "☆ Save"}</button></div>
            <span className="market-job-category">{projectCategoryLabel(project)}</span><h3>{project.title}</h3><p className="card-brief">{project.description || "Project details available in the full brief."}</p>
            <div className="skill-list">{(project.requiredSkills || []).map(item => <span className="skill-chip" key={item}>{item}</span>)}</div>
            <div className="card-facts"><div><small>Budget</small><strong>{money(project.budget)}</strong></div><div><small>Target date</small><strong>{project.deadline}</strong></div></div>
            <button className={`button ${application ? "button-outline" : "button-dark"} full`} disabled={Boolean(application)} onClick={() => openBrief(project)}>{application ? `Application ${application.status.toLowerCase()}` : "View brief & apply ↗"}</button>
          </article>;
        })}</div>}
        {tab === "discover" && !discoveryLoading && !discoveryError && discoveryPages > 1 && <nav className="market-pagination dashboard-pagination" aria-label="Project result pages"><button className="button button-outline" disabled={page <= 1} onClick={() => updateDiscovery({ page: String(page - 1) }, false)}>← Previous</button><span>Page {page} of {discoveryPages}</span><button className="button button-outline" disabled={page >= discoveryPages} onClick={() => updateDiscovery({ page: String(page + 1) }, false)}>Next →</button></nav>}
      </>}
      {tab === "invitations" && (activeInvitations.length === 0 ? <div className="empty-state"><span>✉</span><h3>No active invitations</h3><p>Clients can invite you after you choose to show your profile in talent search.</p><Link className="button button-outline" to="/profile">Edit profile →</Link></div> : <div className="invitation-list">{activeInvitations.map(invitation => <article key={invitation._id}><div className="invitation-top"><span className="status status-open">Invitation</span><small>From {invitation.client?.name || "Client"}</small></div><h3>{invitation.project.title}</h3><p>{invitation.note}</p><div className="skill-list">{(invitation.project.requiredSkills || []).map(item => <span className="skill-chip" key={item}>{item}</span>)}</div><div className="invitation-actions"><strong>{money(invitation.project.budget)} budget</strong><button className="button button-outline" onClick={() => declineInvitation(invitation._id)}>Decline</button><button className="button button-dark" onClick={() => { setSelected(invitation.project); prepareProposal(invitation.project); }}>View & propose ↗</button></div></article>)}</div>)}
      {tab === "assigned" && (loading ? <p role="status">Loading assigned projects…</p> : assigned.length === 0 ? <div className="empty-state"><span>▦</span><h3>No assigned projects yet</h3><p>A project is assigned after both sides agree to the same offer version.</p></div> : <div className="simple-list">{assigned.map(project => <article key={project._id}><div className="project-initial">{project.title[0]}</div><div><strong>{project.title}</strong><small>{project.milestones?.filter(milestone => milestone.status === "completed").length || 0} of {project.milestones?.length || 0} milestones approved</small></div><span className={`status status-${project.status.toLowerCase().replaceAll(" ", "-")}`}>{project.status}</span><Link className="button button-outline" to={`/milestones/${project._id}`}>View milestones ↗</Link></article>)}</div>)}
      {tab === "applications" && (loading ? <p role="status">Loading applications…</p> : applications.length === 0 ? <div className="empty-state"><span>✦</span><h3>No applications yet</h3><p>Find an open project and send your first proposal.</p></div> : <div className="simple-list">{applications.map(application => <article className="application-thread" key={application._id}>
        <div className="project-initial">{application.project?.title?.[0] || "P"}</div>
        <div className="application-summary"><strong>{application.project?.title || "Project unavailable"}</strong><small>Sent {new Date(application.createdAt).toLocaleDateString()} · {application.proposal}</small><small>Proposed {application.proposedPrice == null ? "price not provided" : `${money(application.proposedPrice)} planned`} · {application.deliveryEstimateDays == null ? "delivery estimate not provided" : `${application.deliveryEstimateDays} days`}</small></div>
        <span className={`status status-${application.status.toLowerCase()}`}>{application.status}</span>
        {application.project?._id && <button className="text-button" onClick={() => setMessageApplication(current => current === application._id ? null : application._id)}>{messageApplication === application._id ? "Hide messages" : "Messages"}</button>}
        {application.status === "ACCEPTED" && application.project?._id && <Link className="button button-outline" to={`/milestones/${application.project._id}`}>View project ↗</Link>}
        {application.status === "PENDING" && application.project?.status === "Open" && <><button className="button button-outline" onClick={() => editApplication(application)}>Edit proposal</button><button className="button button-outline" disabled={busy} onClick={() => withdrawApplication(application)}>Withdraw</button></>}
        {editingProposalId === application._id && <form className="proposal-edit-form" onSubmit={event => saveApplicationEdit(event, application)}><label>Proposal<textarea required maxLength="2000" value={proposalEdits.proposal} onChange={event => setProposalEdits(current => ({ ...current, proposal: event.target.value }))} /></label><div className="proposal-terms-inputs"><label>Proposed price<input type="number" min="0.01" step="0.01" required value={proposalEdits.proposedPrice} onChange={event => setProposalEdits(current => ({ ...current, proposedPrice: event.target.value }))} /></label><label>Delivery estimate (days)<input type="number" min="1" max="3650" required value={proposalEdits.deliveryEstimateDays} onChange={event => setProposalEdits(current => ({ ...current, deliveryEstimateDays: event.target.value }))} /></label></div><label>Relevant portfolio links <small>Optional · one HTTP or HTTPS link per line</small><textarea rows="2" value={proposalEdits.portfolioLinks} onChange={event => setProposalEdits(current => ({ ...current, portfolioLinks: event.target.value }))} /></label><label>Optional question<input maxLength="300" value={proposalEdits.answerQuestion} onChange={event => setProposalEdits(current => ({ ...current, answerQuestion: event.target.value }))} placeholder="What would you like the client to know?" /></label><label>Answer<textarea rows="2" maxLength="1000" value={proposalEdits.answerText} onChange={event => setProposalEdits(current => ({ ...current, answerText: event.target.value }))} /></label><button className="button button-dark" disabled={busy}>Save proposal</button><button type="button" className="button button-outline" onClick={() => setEditingProposalId(null)}>Cancel edit</button></form>}
        <HiringOfferPanel application={application} project={application.project || { title: application.project?.title }} role="freelancer" onChange={updated => setApplications(current => current.map(item => item._id === updated._id ? { ...item, ...updated, project: item.project } : item))} onAssigned={() => { setNotice("Terms agreed and project assigned. Your workroom is ready."); load(); }} />
        {messageApplication === application._id && application.project?._id && <div className="conversation-wrap"><ConversationPanel applicationId={application._id} projectId={application.project._id} otherLabel="Client" /></div>}
      </article>)}</div>)}
      {(tab === 'assigned' || tab === 'saved') && <Pagination {...projectInfo} page={projectPage} loading={loading} onPage={setProjectPage} label={tab === 'saved' ? 'saved projects' : 'assigned projects'} />}
      {tab === 'applications' && <Pagination {...applicationInfo} page={applicationPage} loading={loading} onPage={setApplicationPage} label="applications" />}
    </section>
    {selected && <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setSelected(null); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="proposal-title" ref={proposalDialogRef} tabIndex={-1}>
        <div className="dialog-heading"><div><p className="eyebrow">{selected.category || "Other"} · PROJECT BRIEF</p><h2 id="proposal-title">{selected.title}</h2></div><button className="icon-button" onClick={() => setSelected(null)} aria-label="Close">×</button></div>
        {selected.company?.name && <p className="card-client">Posted by {selected.company.name}</p>}
        <p className="dialog-intro">{selected.description || "The client has not added a detailed brief yet."}</p>
        <div className="skill-list">{(selected.requiredSkills || []).map(item => <span className="skill-chip" key={item}>{item}</span>)}</div>
        <div className="brief-facts"><span>Budget <strong>{money(selected.budget)}</strong></span><span>Target date <strong>{selected.deadline}</strong></span></div>
        {selected.company?.overview && <section className="brief-company"><strong>About the client</strong><p>{selected.company.overview}</p></section>}
        <div className="brief-milestones"><strong>Planned milestones</strong>{(selected.milestones || []).map((item, index) => <div key={item._id || item.id || index}><span>{index + 1}. {item.title}</span><small>{money(item.payment)} planned</small>{item.description && <p>{item.description}</p>}</div>)}</div>
        {error && <p className="message error" role="alert">{error}</p>}
        <form onSubmit={apply} className="stack-form">
          <label>Your proposal<textarea required maxLength="2000" rows="5" value={proposal} onChange={event => setProposal(event.target.value)} placeholder="Share your relevant experience and your plan for this project…" /></label>
          <div className="proposal-terms-inputs"><label>Proposed price<input type="number" min="0.01" step="0.01" required value={proposedPrice} onChange={event => setProposedPrice(event.target.value)} /></label><label>Delivery estimate (days)<input type="number" min="1" max="3650" step="1" required value={deliveryEstimateDays} onChange={event => setDeliveryEstimateDays(event.target.value)} /></label></div>
          <label>Relevant portfolio links <small>Optional · one HTTP or HTTPS link per line</small><textarea rows="2" maxLength="1500" value={portfolioLinks} onChange={event => setPortfolioLinks(event.target.value)} placeholder="https://example.com/relevant-work" /></label>
          <label>Optional question<input maxLength="300" value={answerQuestion} onChange={event => setAnswerQuestion(event.target.value)} placeholder="What would you like the client to know?" /></label>
          <label>Answer<textarea rows="2" maxLength="1000" value={answerText} onChange={event => setAnswerText(event.target.value)} /></label>
          <p className="form-help">These are proposed terms only, not payments.</p>
          <div className="dialog-actions"><button type="button" className="button button-outline" onClick={() => setSelected(null)}>Cancel</button><button className="button button-dark" disabled={busy || !proposal.trim() || !proposedPrice || !deliveryEstimateDays || Boolean(answerQuestion.trim()) !== Boolean(answerText.trim())}>{busy ? "Sending…" : "Send proposal ↗"}</button></div>
        </form>
      </div>
    </div>}
  </Shell>;
}
