import ApplicationStatus from "./ApplicationStatus";
import { currentUser } from "../api";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import useLiveUpdates from "../useLiveUpdates";
import TrustEvidence from "./TrustEvidence";
import useDialogAccessibility from "../useDialogAccessibility";
import ConversationPanel from "./ConversationPanel";
import HiringOfferPanel from "./HiringOfferPanel";
import Pagination from "./Pagination";
import { readPage } from "../usePagedList";

export default function ApplicantsDialog({ project, onClose, onDecision }) {
  const dialogRef = useDialogAccessibility(onClose);
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState(() => readPage([]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aiStatus, setAiStatus] = useState(null);
  const [aiResult, setAiResult] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiFallback, setAiFallback] = useState("");
  const analysisVersion = useRef(0);
  const applicantsVersion = useRef(0);
  const [messageApplication, setMessageApplication] = useState(null);
  const [shortlistedOnly, setShortlistedOnly] = useState(false);
  const [budgetFilter, setBudgetFilter] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState("");

  const requestUrl = '/applications/project/'+project._id+'?page='+page+'&pageSize=20'+(shortlistedOnly ? '&shortlisted=true' : '')+(budgetFilter ? '&budget='+budgetFilter : '')+(availabilityFilter ? '&availability='+availabilityFilter : '');
  const invalidateAi = useCallback((note = "") => {
    analysisVersion.current += 1;
    setAiResult(null); setAnalyzing(false); setAiFallback(note);
  }, []);
  const replaceApplicants = useCallback(value => {
    applicantsVersion.current += 1;
    invalidateAi();
    setApplications(value);
  }, [invalidateAi]);

  const acceptPage = useCallback(result => {
    const data = readPage(result, page, 20);
    if (page > Math.max(1,data.pages)) { setPage(Math.max(1,data.pages)); return; }
    setPageInfo(data); replaceApplicants(data.items);
  }, [page, replaceApplicants]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); replaceApplicants([]); setAiStatus(null);
    const version = applicantsVersion.current;
    api(requestUrl).then(result => { if (active && version === applicantsVersion.current) acceptPage(result); }).catch(err => { if (active && version === applicantsVersion.current) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    api("/applications/ai-status").then(result => { if (active) setAiStatus(result); }).catch(() => { if (active) setAiStatus({ available: false }); });
    return () => { active = false; analysisVersion.current += 1; applicantsVersion.current += 1; };
  }, [project._id, requestUrl, replaceApplicants, acceptPage]);
  useLiveUpdates(event => {
    if (event.type !== "reconnected" && !(event.type === "applications" && event.projectId === project._id)) return;
    invalidateAi();
    const version = ++applicantsVersion.current;
    api(requestUrl).then(result => { if (version === applicantsVersion.current) acceptPage(result); }).catch(err => { if (version === applicantsVersion.current) setError(err.message); });
  });

  async function compareWithAi() {
    const version = ++analysisVersion.current;
    setError(""); setAnalyzing(true); setAiResult(null); setAiFallback("");
    try {
      const result = await api(`/applications/project/${project._id}/ai-rank`, { method: "POST" });
      if (version === analysisVersion.current) setAiResult(result);
    } catch (err) { if (version === analysisVersion.current) { setError(err.message); setAiFallback("AI comparison could not finish. Regular fit scores and shortlist remain available below."); } }
    finally { if (version === analysisVersion.current) setAnalyzing(false); }
  }

  async function decide(applicationId, action) {
    invalidateAi();
    setBusy(true); setError("");
    try {
      await api(`/applications/${applicationId}/${action}`, { method: "PATCH" });
      acceptPage(await api(requestUrl));
      onDecision(action);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function toggleShortlist(application) {
    invalidateAi();
    setBusy(true); setError("");
    try {
      await api(`/applications/${application._id}/shortlist`, { method: "PATCH", body: JSON.stringify({ shortlisted: !application.shortlisted }) });
      acceptPage(await api(requestUrl));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const aiRanks = new Map((aiResult?.ranking || []).map(item => [item.applicationId, item]));
  const sorted = [...applications].sort((a, b) => {
    const statusOrder = (a.status === "PENDING" ? 0 : 1) - (b.status === "PENDING" ? 0 : 1);
    return statusOrder || Number(Boolean(b.shortlisted)) - Number(Boolean(a.shortlisted)) || (aiRanks.get(a._id)?.rank ?? Infinity) - (aiRanks.get(b._id)?.rank ?? Infinity) || (b.match?.score ?? -1) - (a.match?.score ?? -1);
  });
  const visibleApplications = sorted.filter(application => (!shortlistedOnly || application.shortlisted)
    && (!budgetFilter || application.match?.compatibility?.budget === budgetFilter)
    && (!availabilityFilter || application.match?.compatibility?.availability === availabilityFilter));

  return <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog applicants-dialog" role="dialog" aria-modal="true" aria-labelledby="applicants-title" ref={dialogRef} tabIndex={-1}>
      <div className="dialog-heading"><div><p className="eyebrow">APPLICATIONS</p><h2 id="applicants-title">{project.title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close">×</button></div>
      <div className="applicants-body">
      {error && <p className="message error" role="alert">{error}</p>}
      {aiFallback && <p className="message" role="status">{aiFallback}</p>}
      {loading ? <p className="empty-state">Loading proposals…</p> : (pageInfo.summary?.all ?? sorted.length) === 0 ? <p className="empty-state">No applications yet. Your project is visible to freelancers.</p> : <>
        <div className="shortlist-toolbar"><p className="shortlist-intro">Review proposals, compare relevant experience, then agree terms to hire.</p><button className={`button ${shortlistedOnly ? "button-dark" : "button-outline"}`} type="button" aria-pressed={shortlistedOnly} onClick={() => { setShortlistedOnly(value => !value); setPage(1); }}>★ {shortlistedOnly ? "Show all applicants" : `Shortlisted (${(pageInfo.summary?.shortlisted ?? applications.filter(item => item.shortlisted).length)})`}</button></div>
        <div className="applicants-filters"><label>Budget compatibility<select value={budgetFilter} onChange={event => { setBudgetFilter(event.target.value); setPage(1); }}><option value="">All proposals</option><option value="within_budget">Within budget</option><option value="above_budget">Above budget</option><option value="unknown">Unknown budget compatibility</option></select></label><label>Applicant availability<select value={availabilityFilter} onChange={event => { setAvailabilityFilter(event.target.value); setPage(1); }}><option value="">All availability</option><option value="available">Available</option><option value="limited">Limited</option><option value="unavailable">Unavailable</option><option value="unknown">Unknown availability</option></select></label></div><p className="filter-explanation">Budget uses the proposed price. Availability is self-reported; filters do not change fit scores.</p>
        {project.status === "Open" && sorted.some(item => item.status === "PENDING") && (aiStatus?.available ? <section className="ai-comparison"><div><strong>AI comparison</strong><p>Comparing sends the project brief and applicant profile/proposal text to {aiStatus.providerName || "OpenAI"}.</p></div><button className="button button-outline" type="button" disabled={analyzing || busy || (pageInfo.summary?.pending ?? sorted.filter(item => item.status === "PENDING").length) > aiStatus.maxCandidates} onClick={compareWithAi}>{analyzing ? "Comparing…" : "Compare with AI"}</button><details className="ai-sharing-details"><summary>What is shared?</summary><p>Free text may contain personal details. Names and email addresses are not added separately. {aiStatus.dataNotice || ""} Results measure text similarity and support your review; they do not decide who is hired.</p></details>{aiResult && <p className="ai-explanation">{aiResult.explanation}</p>}</section> : <p className="ai-unavailable">Compare proposals below. AI comparison is unavailable.</p>)}
        {visibleApplications.length === 0 && <div className="empty-state"><h3>{budgetFilter || availabilityFilter ? "No applicants match these filters" : "No shortlisted applicants"}</h3><p>Adjust compatibility filters or show all applicants.</p><button className="button button-outline" onClick={() => { setShortlistedOnly(false); setBudgetFilter(""); setAvailabilityFilter(""); setPage(1); }}>Show all applicants</button></div>}
        <div className="application-list">{visibleApplications.map(application => {
          const freelancer = application.freelancer || {};
          const profile = freelancer.profile || {};
          const trust = application.trust;
          const match = application.match;
          const ai = aiRanks.get(application._id);
          return <article className="application-card" key={application._id}>
            <div className="application-top"><div className="avatar">{freelancer.name?.[0]?.toUpperCase() || "F"}</div><div><strong>{freelancer.name || "Freelancer"}</strong><small>{profile.headline || "Freelancer"} · Applied {new Date(application.createdAt).toLocaleDateString()}</small></div><ApplicationStatus application={application} project={project} role="client" userId={typeof currentUser === "function" ? currentUser()?.id : null} /></div>
            {ai && <div className="ai-result"><strong>AI-assisted rank #{ai.rank} · {ai.score}/100</strong><span>Text similarity {ai.semanticScore}/100 · Regular fit {ai.ruleScore}/100</span><small>Listed skills: {ai.matchedSkills?.length ? ai.matchedSkills.join(", ") : "none matched"}. {ai.missingSkills?.length ? `Not listed: ${ai.missingSkills.join(", ")}.` : ""} Trust: {ai.evidence?.score == null ? "new account" : `${ai.evidence.scoredMilestones ?? ai.evidence.approvedMilestones} of ${ai.evidence.approvedMilestones} approvals counted`}.</small></div>}
            <p className="form-help">Budget: {match?.compatibility?.budget === "within_budget" ? "Within budget" : match?.compatibility?.budget === "above_budget" ? `Above budget by ₹${Number(match.compatibility.budgetDifference).toLocaleString("en-IN")}` : "Unknown"} · Availability: {({ available: "Available", limited: "Limited", unavailable: "Unavailable" })[match?.compatibility?.availability] || "Unknown"}</p>
            <div className="proposal-box"><span>PROPOSAL{application.proposalRevision > 1 ? ` · REVISION ${application.proposalRevision}` : ""}</span><p>{application.proposal || "Legacy text-only proposal"}</p><div className="proposal-terms"><span>Proposed price <strong>{application.proposedPrice == null ? "Not provided" : `₹${Number(application.proposedPrice).toLocaleString("en-IN")}`}</strong></span><span>Delivery estimate <strong>{application.deliveryEstimateDays == null ? "Not provided" : `${application.deliveryEstimateDays} days`}</strong></span></div>{application.portfolioLinks?.map(link => <a key={link} href={link} target="_blank" rel="noreferrer">Relevant work ↗</a>)}{application.answers?.map((item, index) => <p className="proposal-answer" key={index}><strong>{item.question}</strong><br />{item.answer}</p>)}</div>
            {freelancer.suspended && <p className="message error">This account is suspended. New hiring actions are blocked.</p>}
            <details className="applicant-evidence"><summary>View skills, fit and verified work</summary>
            {match && <div className="match-summary"><div><strong>Comparison score: {match.score}/100</strong><span>{match.matchedSkills?.length || 0} of {(match.matchedSkills?.length || 0) + (match.missingSkills?.length || 0)} listed skills</span></div><div className="match-track"><span style={{ width: `${match.score}%` }} /></div><p>{match.matchedSkills?.length ? `Matches: ${match.matchedSkills.join(", ")}.` : "No listed skills match yet."} {match.missingSkills?.length ? `Not listed: ${match.missingSkills.join(", ")}.` : ""}</p><p>Context relevance: {match.contextScore == null ? "Not available" : `${match.contextScore}/100 (profile ${match.contextProfileScore}, proposal ${match.contextProposalScore})`}{match.contextMatchedTerms?.length ? ` · Shared terms: ${match.contextMatchedTerms.join(", ")}` : " · No shared context terms yet"}.</p><small>{match.yearsExperience || 0} years self-reported experience · {match.factorScores?.verifiedTrust == null ? "Verified trust not scored (no platform history)" : `Verified trust ${match.factorScores.verifiedTrust}/100`} · 65% skill, experience and verified-work fit + 35% profile-led context. Comparison aid, not a probability or hiring decision.</small></div>}
            <div className="applicant-profile"><div><span>EXPERIENCE</span><strong>{profile.experienceYears || 0} years</strong></div><div><span>SKILLS</span><div className="skill-list">{profile.skills?.length ? profile.skills.map(skill => <span className="skill-chip" key={skill}>{skill}</span>) : <small>Not added yet</small>}</div></div>{profile.bio && <p>{profile.bio}</p>}{profile.portfolioUrl && <a href={profile.portfolioUrl} target="_blank" rel="noreferrer">View portfolio ↗</a>}</div>
            {trust && <div className="trust-summary"><div><span>TRUST SCORE</span><strong>{trust.score === null ? trust.label : `${trust.score}/100`}</strong></div><p>{trust.approvedMilestones} approved milestones · {trust.completedProjects} completed projects · {trust.revisionRequests} revision requests</p><TrustEvidence trust={trust} /><small>{trust.score === null ? "No verified work yet; this does not lower the fit estimate." : `${trust.label}. Based only on approved milestones and revision history.`}</small></div>}
            </details>
            <HiringOfferPanel application={application} project={project} role="client" onChange={updated => replaceApplicants(current => current.map(item => item._id === updated._id ? { ...item, ...updated, freelancer: item.freelancer } : item))} onAssigned={() => { onDecision("agreed"); onClose(); }} />
            <button type="button" className="text-button conversation-toggle" onClick={() => setMessageApplication(current => current === application._id ? null : application._id)}>{messageApplication === application._id ? "Hide messages" : `Message ${freelancer.name || "freelancer"} →`}</button>
            {messageApplication === application._id && <ConversationPanel applicationId={application._id} projectId={project._id} otherLabel={freelancer.name || "Freelancer"} />}
            {application.status === "PENDING" && project.status === "Open" && <div className="application-actions"><button className="button button-outline" disabled={busy} onClick={() => toggleShortlist(application)}>{application.shortlisted ? "Remove from shortlist" : "★ Shortlist"}</button><button className="button button-outline" disabled={busy} onClick={() => decide(application._id, "reject")}>Decline proposal</button></div>}
          </article>;
        })}</div>
      </>}
      <Pagination page={page} pages={pageInfo.pages} total={pageInfo.total} loading={loading} onPage={setPage} label="applicants" />
      </div>
    </div>
  </div>;
}
