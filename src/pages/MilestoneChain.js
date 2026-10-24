import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, currentUser } from "../api";
import DeliveryOutlook from "../components/DeliveryOutlook";
import CheckIcon from "../components/CheckIcon";
import { todayISO } from "../projectDates";
import ReviewPanel from "../components/ReviewPanel";
import NotificationCenter from "../components/NotificationCenter";
import useLiveUpdates from "../useLiveUpdates";
import ConversationPanel from "../components/ConversationPanel";
import AttachmentList from "../components/AttachmentList";
import ProjectChanges from "../components/ProjectChanges";
import ProjectControls from "../components/ProjectControls";
import ProjectForm from "../components/ProjectForm";
import WorkroomCasePanel from "../components/WorkroomCasePanel";

const labels = { locked: "Locked", active: "In progress", submitted: "Awaiting approval", revision_requested: "Changes requested", completed: "Approved" };
const activityLabels = { change_requested: "Project change requested", change_accepted: "Project change agreed", change_declined: "Project change declined", change_withdrawn: "Project change withdrawn", listing_edited: "Project brief updated", hiring_closed: "Hiring closed", hiring_reopened: "Hiring reopened", cancellation_requested: "Cancellation requested", cancellation_declined: "Cancellation declined", cancellation_withdrawn: "Cancellation withdrawn", project_cancelled: "Project cancelled", project_created: "Project created", freelancer_assigned: "Freelancer assigned", work_submitted: "Work submitted", work_resubmitted: "Revised work submitted", revision_requested: "Changes requested", milestone_approved: "Milestone approved", milestone_unlocked: "Milestone unlocked", project_completed: "Project completed", case_opened: "Project case opened", case_updated: "Project case updated" };
const money = value => `₹${Number(value || 0).toLocaleString("en-IN")}`;
const dateLabel = value => value ? new Date(value).toLocaleString() : "";

export default function MilestoneChain() {
  const { projectId } = useParams();
  const user = currentUser();
  const [project, setProject] = useState(null);
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [submittedWork, setSubmittedWork] = useState("");
  const [submissionFiles, setSubmissionFiles] = useState([]);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api(`/projects/${projectId}`);
      setProject(data);
      setSelectedId(current => data.milestones.some(item => item._id === current) ? current : data.milestones.find(item => item.status !== "locked")?._id || data.milestones[0]?._id);
      setError("");
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  const liveStatus = useLiveUpdates(event => { if (event.type === "reconnected" || (event.type === "project" && event.projectId === projectId)) load(); });

  async function action(kind) {
    const milestone = project?.milestones.find(item => item._id === selectedId);
    if (!milestone) return;
    setBusy(true); setError(""); setNotice("");
    try {
      let body = null;
      if (kind === "submit" && submissionFiles.length) {
        body = new FormData();
        body.append("submittedWork", submittedWork.trim());
        submissionFiles.forEach(file => body.append("files", file));
      } else if (kind === "submit") body = JSON.stringify({ submittedWork: submittedWork.trim() });
      else if (kind === "request-revision") body = JSON.stringify({ feedback: feedback.trim(), submissionId: String(milestone.submissions?.at(-1)?._id || "") });
      else if (kind === "approve") body = JSON.stringify({ submissionId: String(milestone.submissions?.at(-1)?._id || "") });
      await api(`/projects/${projectId}/milestone/${milestone._id}/${kind}`, { method: "POST", ...(body ? { body } : {}) });
      setSubmittedWork(""); setSubmissionFiles([]); setFeedback("");
      setNotice(kind === "submit" ? "Work submitted for client review." : kind === "approve" ? "Milestone approved. Ready steps are now available." : "Revision request sent to the freelancer.");
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const back = user?.role === "client" ? "/client-dashboard" : "/freelancer-dashboard";
  const canWork = project?.status === "In Progress" && !project?.pendingCancellation && !project?.pendingAmendment;
  const milestones = project?.milestones || [];
  const selected = milestones.find(item => item._id === selectedId);
  const complete = milestones.filter(item => item.status === "completed").length;
  const dependencyIds = selected ? project.hasExplicitDependencies ? (selected.dependsOn || []).map(String) : milestones.indexOf(selected) > 0 ? [milestones[milestones.indexOf(selected) - 1]._id] : [] : [];
  const dependencies = milestones.filter(item => dependencyIds.includes(item._id));
  const submissions = selected?.submissions?.length ? selected.submissions : selected?.submittedWork ? [{ work: selected.submittedWork, submittedAt: selected.submittedAt }] : [];

  return <div className="milestone-page-new">
    <header className="milestone-nav"><Link className="brand" to="/"><span className="brand-mark">✦</span>Freelance<span className="brand-light">Chain</span></Link><div className="milestone-nav-actions"><NotificationCenter /><Link className="back-link" to={back}>← Back to workspace</Link></div></header>
    <main className="milestone-main">
      <div className="milestone-page-header"><div><p className="eyebrow">PROJECT WORKFLOW</p><h1>{project?.title || (loading ? "Loading project…" : "Project unavailable")}</h1><p>Track work, feedback, approvals and the steps they unlock.</p></div><div className="live-heading">{liveStatus === "live" && <span className="live-pill">Live updates</span>}{liveStatus === "reconnecting" && <span className="live-pill reconnecting">Reconnecting…</span>}{project && <span className={`status status-${project.status.toLowerCase().replaceAll(" ", "-")}`}>{project.status}</span>}</div></div>
      {error && <div className="message error" role="alert">{error}</div>}{notice && <div className="message success" role="status">{notice}</div>}
      {project && <>
        {user?.role === "freelancer" && String(project.freelancer?._id || project.freelancer) === String(user.id || user._id) && <section className="panel task-board-entry"><div><h2>Your private task board</h2><p>Break this project into daily tasks and link them to milestones.</p></div><Link className="button button-outline" to={`/task-boards/${projectId}`}>Open task board →</Link></section>}
        {project.freelancer && <ProjectChanges project={project} user={user} onChanged={load} />}
        <ProjectControls project={project} user={user} onEdit={() => setEditing(true)} onChanged={load} />
        <div className="milestone-summary"><div><span>PROGRESS</span><strong>{complete} <small>/ {milestones.length} approved · {milestones.length ? Math.round(complete / milestones.length * 100) : 0}%</small></strong></div><div className="progress-track"><span style={{ width: `${milestones.length ? complete / milestones.length * 100 : 0}%` }} /></div><div><span>PROJECT BUDGET</span><strong>{money(project.budget)}</strong></div><div><span>DEADLINE</span><strong>{project.deadline}</strong></div></div>
        {project.insights && ["urgent", "attention"].includes(project.insights.level) && <div className={`pulse-strip pulse-${project.insights.level}`}><strong>{project.insights.level === "urgent" ? "Deadline needs action" : "Project needs attention"}</strong><span>{project.insights.reasons.join(" ")}</span></div>}
        {project.status === "In Progress" && project.outlook && <section className="outlook-detail" aria-label="Delivery outlook"><div><p className="eyebrow">DELIVERY OUTLOOK</p><p>A rough estimate from approved milestone timing and recorded activity. This is not an AI prediction or a guarantee.</p></div><DeliveryOutlook project={project} /></section>}
        <div className="milestone-layout">
          <section className="panel"><div className="panel-heading"><div><p className="eyebrow">THE PLAN</p><h2>Milestone journey</h2></div></div><div className="timeline">{milestones.map((item, index) => <button key={item._id} className={`timeline-step ${item.status} ${selectedId === item._id ? "selected" : ""}`} onClick={() => { setSelectedId(item._id); setSubmittedWork(""); setSubmissionFiles([]); setFeedback(""); }}><span className="timeline-track"><span className="timeline-number">{item.status === "completed" ? <CheckIcon /> : String(index + 1).padStart(2, "0")}</span></span><span className="timeline-content"><span className="timeline-title">{item.title}</span><small>{item.description || "No description provided"}</small><span className="timeline-meta">{money(item.payment)} planned{item.dueDate ? ` · Due ${item.dueDate}` : ""} · {labels[item.status] || item.status}{item.status !== "completed" && item.dueDate && item.dueDate < todayISO() ? " · Past target date" : ""}</span></span><span className="timeline-arrow">↗</span></button>)}</div></section>
          <aside className="panel milestone-detail"><p className="eyebrow">STEP DETAILS</p>{selected ? <>
            <div className="detail-heading"><span className={`detail-icon ${selected.status}`}>{selected.status === "completed" ? <CheckIcon /> : "✦"}</span><span className={`status status-${selected.status}`}>{labels[selected.status]}</span></div>
            <h2>{selected.title}</h2><p>{selected.description || "No description provided for this milestone."}</p>
            <div className="detail-facts"><div><span>Planned amount</span><strong>{money(selected.payment)}</strong></div><div><span>Status</span><strong>{labels[selected.status]}</strong></div><div><span>Revisions</span><strong>{selected.revisionCount || 0}</strong></div></div>
            <div className="dependency-detail"><strong>Prerequisites</strong>{dependencies.length ? <ul>{dependencies.map(item => <li key={item._id}>{item.title} <span>{item.status === "completed" ? <><CheckIcon /> Approved</> : "Pending approval"}</span></li>)}</ul> : <p>None. This step is available from the start.</p>}</div>
            {selected.status === "locked" && <div className="info-box">This step unlocks when all prerequisites are approved.</div>}
            {selected.revisionFeedback && <div className="feedback-box"><strong>Latest client feedback</strong><p>{selected.revisionFeedback}</p></div>}
            {canWork && (["active", "revision_requested"].includes(selected.status)) && user?.role === "freelancer" && <div className="detail-action"><h3>{selected.status === "revision_requested" ? "Submit revised work" : "Submit your work"}</h3><p>Describe what you completed and attach the deliverable.</p><textarea aria-label="Work description" rows="6" maxLength="5000" value={submittedWork} onChange={event => setSubmittedWork(event.target.value)} placeholder="Summarize your work…" /><label className="file-picker">Attach deliverables<input type="file" accept=".pdf,.txt,.csv,.png,.jpg,.jpeg,.webp" multiple onChange={event => setSubmissionFiles(Array.from(event.target.files || []).slice(0, 3))} /></label>{submissionFiles.length > 0 && <small className="selected-files">{submissionFiles.map(file => file.name).join(", ")}</small>}<button className="button button-dark full" disabled={busy || (!submittedWork.trim() && !submissionFiles.length)} onClick={() => action("submit")}>{busy ? "Submitting…" : selected.status === "revision_requested" ? "Resubmit for approval ↗" : "Submit for approval ↗"}</button></div>}
            {selected.status === "submitted" && <div className="detail-action"><h3>Submitted work · Version {selected.submissions?.at(-1)?.version || selected.submissions?.length || 1}</h3><div className="submission-box">{selected.submittedWork}</div><AttachmentList projectId={projectId} attachments={selected.submissions?.at(-1)?.files} />{canWork && user?.role === "client" ? <><button className="button button-dark full" disabled={busy} onClick={() => action("approve")}>{busy ? "Approving…" : <>Approve latest version <CheckIcon /></>}</button><label className="revision-label">Request changes<textarea aria-label="Revision feedback" rows="4" minLength="10" maxLength="1000" value={feedback} onChange={event => setFeedback(event.target.value)} placeholder="Explain what needs to change…" /></label><button className="button button-outline full" disabled={busy || feedback.trim().length < 10} onClick={() => action("request-revision")}>Send revision request</button></> : <p className="form-help">{canWork ? "Latest version is waiting for client review." : "Submission retained in project history."}</p>}</div>}
            {canWork && selected.status === "revision_requested" && user?.role === "client" && <div className="info-box">Waiting for the freelancer to submit revised work.</div>}
            {selected.status === "completed" && <div className="info-box success-box">Approved{selected.approvedAt ? ` on ${new Date(selected.approvedAt).toLocaleDateString()}` : ""}. This step is complete.</div>}
              {submissions.length > 0 && <div className="submission-history"><h3>Submission history</h3>{submissions.map((entry, index) => <article key={entry._id || index}><div><strong>Version {entry.version || index + 1}</strong><small>{entry.author?.name ? `${entry.author.name} · ` : ""}{dateLabel(entry.submittedAt)}</small></div>{entry.work && <p>{entry.work}</p>}<AttachmentList projectId={projectId} attachments={entry.files} />{selected.revisionRequests?.filter(item => String(item.submission) === String(entry._id)).map((item, feedbackIndex) => <blockquote key={item._id || feedbackIndex}><strong>Client feedback · {dateLabel(item.createdAt)}</strong><p>{item.feedback}</p></blockquote>)}</article>)}</div>}
          </> : <p>Select a milestone to see its details.</p>}</aside>
        </div>
        <section className="panel activity-panel"><div className="panel-heading"><div><p className="eyebrow">PROJECT RECORD</p><h2>Activity history</h2></div></div>{project.activity?.length ? <ol>{[...project.activity].reverse().map((entry, index) => <li key={entry._id || index}><span className="activity-dot" /><div><strong>{activityLabels[entry.type] || entry.type}{entry.milestoneTitle ? ` · ${entry.milestoneTitle}` : ""}</strong><p>{entry.note}</p><small>{entry.actorName ? `${entry.actorName} · ` : ""}{dateLabel(entry.createdAt)}</small></div></li>)}</ol> : <p className="activity-empty">Earlier projects may not have activity recorded yet. New actions appear here.</p>}</section>
        {project.conversationApplicationId && <section className="panel workroom-conversation"><div className="panel-heading"><div><p className="eyebrow">PROJECT CONVERSATION</p><h2>Shared messages</h2></div></div><ConversationPanel applicationId={project.conversationApplicationId} projectId={projectId} otherLabel={user?.role === "client" ? project.freelancer?.name || "Freelancer" : project.client?.name || "Client"} /></section>}
        <WorkroomCasePanel projectId={projectId} projectStatus={project.status} />
        {project.status === "Completed" && <ReviewPanel projectId={projectId} role={user?.role} />}
      </>}
      {editing && project && <ProjectForm initialProject={project} onClose={() => setEditing(false)} onCreated={async () => { setEditing(false); await load(); }} />}
    </main>
  </div>;
}
