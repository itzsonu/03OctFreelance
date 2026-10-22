import React from "react";
import { Link } from "react-router-dom";
import { currentUser } from "../api";
import Shell from "../components/Shell";
import Pagination from "../components/Pagination";
import usePagedList from "../usePagedList";

export default function WorkroomInbox() {
  const role = currentUser()?.role;
  const listing = usePagedList("/workrooms/inbox");
  const { items: entries, loading, error } = listing;

  return <Shell role={role} eyebrow="PROJECT WORKROOMS" title="Project inbox" subtitle="One private room for each hired project, including its conversation and delivery history.">
    {error && <div className="message error" role="alert">{error}</div>}
    {loading ? <p className="empty-state">Loading project conversations…</p> : entries.length ? <section className="workroom-inbox-list" aria-label="Hired project conversations">
      {entries.map(entry => <article className="workroom-inbox-row" key={entry.projectId}>
        <div className="workroom-inbox-main"><p className="eyebrow">{entry.status === "Completed" ? "COMPLETED PROJECT" : "HIRED PROJECT"}</p><h2>{entry.title}</h2><p>Target date: {entry.deadline || "Not set"}</p></div>
        <div className="workroom-inbox-flags">{entry.unreadCount > 0 && <span className="inbox-flag unread">{entry.unreadCount} unread</span>}{entry.pendingAction && <span className="inbox-flag pending">{role === "client" ? "Review submitted work" : "Revision to submit"}</span>}{entry.overdue && <span className="inbox-flag overdue">Past target date</span>}</div>
        <span className={`status status-${entry.status.toLowerCase().replaceAll(" ", "-")}`}>{entry.status}</span>
        <Link className="button button-dark" to={`/milestones/${entry.projectId}`}>Open workroom ↗</Link>
      </article>)}
    </section> : <div className="empty-state"><span>▤</span><h3>No project conversations yet</h3><p>Hired projects will appear here with their shared milestones and messages.</p><Link className="button button-outline" to={role === "client" ? "/client-dashboard" : "/freelancer-dashboard"}>Back to workspace</Link></div>}
    <Pagination {...listing} onPage={listing.setPage} label="workrooms" />
  </Shell>;
}