import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import Shell from "../components/Shell";
import BrowserTimings from "../components/BrowserTimings";
import Pagination from "../components/Pagination";
import usePagedList from "../usePagedList";
import useDialogAccessibility from "../useDialogAccessibility";

function ModerationForm({ target, kind, onClose, onComplete }) {
  const ref = useDialogAccessibility(onClose);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const action = kind === "users" ? target.suspended ? "restore" : "suspend" : target.moderationHidden ? "show" : "hide";
  const label = { suspend: "Suspend account", restore: "Restore account", hide: "Hide listing", show: "Restore listing" }[action];
  return <div className="modal-overlay"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="moderation-title" tabIndex={-1} ref={ref}><div className="dialog-heading"><h2 id="moderation-title">{label}</h2><button type="button" className="icon-button" disabled={busy} aria-label="Close moderation" onClick={onClose}>×</button></div><h3>{target.name || target.title}</h3><p>{kind === "users" ? "Suspending blocks sign-in and revokes existing sessions. Restored users must sign in again." : "A hidden listing cannot receive new proposals or agreements. Restoring retains its existing hiring status. Assigned work must be handled through case review."}</p>
    {error && <p className="message error" role="alert">{error}</p>}<form className="stack-form" onSubmit={async event => { event.preventDefault(); setBusy(true); setError(""); try { const result = await api(`/admin/${kind}/${target._id}/moderation`, { method: "POST", body: JSON.stringify({ action, reason: reason.trim(), version: kind === "users" ? target.moderationVersion || 0 : target.__v || 0 }) }); onComplete(result.message); } catch (err) { setError(err.message); } finally { setBusy(false); } }}><label>Decision reason<textarea required minLength="10" maxLength="1000" rows="4" value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label><p className="form-help">Your name, reason and time are retained in this record’s moderation history.</p><div className="dialog-actions"><button type="button" className="button button-outline" disabled={busy} onClick={onClose}>Cancel</button><button className="button button-dark" disabled={busy || reason.trim().length < 10}>{busy ? "Saving…" : `Confirm ${label.toLowerCase()}`}</button></div></form>
  </div></div>;
}

export default function AdminDashboard() {
  const [overview, setOverview] = useState(null);
  const [kind, setKind] = useState("users");
  const [query, setQuery] = useState(""); const [search, setSearch] = useState("");
  const [state, setState] = useState(""); const [role, setRole] = useState("");
  const [target, setTarget] = useState(null); const [history, setHistory] = useState(null);
  const [notice, setNotice] = useState(""); const [error, setError] = useState("");
  const params = new URLSearchParams({ ...(search ? { q: search } : {}), ...(state ? { state } : {}), ...(kind === "users" && role ? { role } : {}) });
  const list = usePagedList(`/admin/${kind}?${params}`);
  const audit = usePagedList(`/admin/moderation/${kind}/${history?._id || "none"}`, 10, Boolean(history));
  async function loadOverview() { try { setOverview(await api("/admin/overview")); setError(""); } catch (err) { setError(err.message); } }
  useEffect(() => { loadOverview(); }, []);
  function changeKind(value) { setKind(value); setState(""); setRole(""); setSearch(""); setQuery(""); setHistory(null); list.setPage(1); audit.setPage(1); }
  const metrics = [["Total users", "users"], ["Active projects", "activeProjects"], ["Completed projects", "completedProjects"], ["Pending reports", "pendingCases"], ["Suspended accounts", "suspended"], ["Hidden listings", "hiddenListings"]];
  return <Shell role="admin" eyebrow="PLATFORM ADMINISTRATION" title="Platform overview" subtitle="Review platform totals, manage account access and moderate unassigned listings." action={<Link className="button button-outline" to="/admin/cases">Review project cases ↗</Link>}>
    {notice && <p className="message success" role="status">{notice}</p>}{error && <p className="message error" role="alert">{error}<button type="button" className="text-button" onClick={loadOverview}>Retry overview</button></p>}
    <div className="metrics-grid admin-overview-metrics">{metrics.map(([label, key]) => <div className="metric-card" key={key}><span>{label}</span><strong>{overview ? overview[key] ?? 0 : "…"}</strong><small>{key === "pendingCases" ? "Open project cases" : "Across the platform"}</small></div>)}</div>
    <section className="panel moderation-panel"><div className="panel-heading"><h2>Moderation</h2><button type="button" className="text-button" disabled={list.loading} onClick={() => { list.reload(); loadOverview(); }}>Refresh records</button></div><div className="moderation-tabs"><button type="button" className={`button ${kind === "users" ? "button-dark" : "button-outline"}`} aria-pressed={kind === "users"} onClick={() => changeKind("users")}>Accounts</button><button type="button" className={`button ${kind === "projects" ? "button-dark" : "button-outline"}`} aria-pressed={kind === "projects"} onClick={() => changeKind("projects")}>Project listings</button></div>
      <form className="moderation-filters" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); list.setPage(1); }}><label>Search records<input value={query} maxLength="80" onChange={event => setQuery(event.target.value)} placeholder={kind === "users" ? "Name or email" : "Project title"} /></label><label>Record state<select value={state} onChange={event => { setState(event.target.value); list.setPage(1); }}><option value="">All</option>{kind === "users" ? <><option value="active">Active</option><option value="suspended">Suspended</option></> : <><option value="visible">Not hidden</option><option value="hidden">Hidden</option></>}</select></label>{kind === "users" && <label>Account role<select value={role} onChange={event => { setRole(event.target.value); list.setPage(1); }}><option value="">All roles</option><option value="client">Client</option><option value="freelancer">Freelancer</option><option value="admin">Admin</option></select></label>}<button className="button button-outline">Search</button></form>
      {list.error && <p className="message error" role="alert">{list.error}</p>}{list.loading ? <p role="status">Loading records…</p> : !list.items.length ? <p>No matching records.</p> : list.items.map(item => <article className="moderation-row" key={item._id}><div><h3>{item.name || item.title}</h3><p>{kind === "users" ? `${item.email} · ${item.role}` : `${item.client?.name || "Client"} · ${item.status}`}</p><strong>{kind === "users" ? item.suspended ? "Suspended" : "Active account" : item.moderationHidden ? "Hidden by admin" : "Not hidden"}</strong>{item.moderationReason && <p className="moderation-reason">Latest decision: {item.moderationReason}</p>}{kind === "projects" && <p>{item.description}</p>}</div><div className="moderation-actions"><button type="button" className="button button-outline" disabled={kind === "users" ? item.role === "admin" : Boolean(item.freelancer) || !["Open", "Closed"].includes(item.status)} onClick={() => setTarget(item)}>{kind === "users" ? item.suspended ? "Restore account" : "Suspend account" : item.moderationHidden ? "Restore listing" : "Hide listing"}</button><button type="button" className="text-button" onClick={() => { setHistory(item); audit.setPage(1); }}>View history</button></div></article>)}
      <Pagination {...list} onPage={list.setPage} label={kind === "users" ? "accounts" : "listings"} />
    </section>
    {history && <section className="panel moderation-history"><div className="panel-heading"><h2>Moderation history: {history.name || history.title}</h2><button type="button" className="text-button" onClick={() => setHistory(null)}>Close history</button></div>{audit.error && <p className="message error" role="alert">{audit.error}</p>}{audit.loading ? <p>Loading history…</p> : audit.items.length ? <ol>{audit.items.map(entry => <li key={entry._id}><strong>{entry.action} · {entry.adminName}</strong><p>{entry.reason}</p><time>{new Date(entry.at).toLocaleString()}</time></li>)}</ol> : <p>No moderation decisions recorded.</p>}<Pagination {...audit} onPage={audit.setPage} label="decisions" /></section>}
    <BrowserTimings />
    {target && <ModerationForm key={target._id} target={target} kind={kind} onClose={() => setTarget(null)} onComplete={message => { setTarget(null); setNotice(message); list.reload(); loadOverview(); if (history?._id === target._id) audit.reload(); }} />}
  </Shell>;
}
