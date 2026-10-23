import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import Shell from "../components/Shell";
import Pagination from "../components/Pagination";
import useTaskUpdates from "../useTaskUpdates";
import { localDay, dateLabel } from "../taskDates";

const views = [["open", "All open"], ["today", "Today"], ["upcoming", "Upcoming"], ["overdue", "Overdue"], ["done", "Done"]];
const labels = { todo: "To do", in_progress: "In progress", review: "Review", done: "Done" };
export default function MyTasks() {
  const [search, setSearch] = useSearchParams();
  const view = search.get("view") || "open", q = search.get("q") || "", priority = search.get("priority") || "";
  const rawPage = Number(search.get("page") || 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 10000 ? rawPage : 1;
  const [queryDraft, setQueryDraft] = useState(q);
  const [today, setToday] = useState(localDay);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const path = `/task-boards/mine?${new URLSearchParams({ view, q, priority, page, pageSize: 20, today })}`;
  const live = useTaskUpdates(async () => {
    const version = generation.current;
    try {
      const result = await api(path);
      if (generation.current === version) { setData(result); setError(""); }
    } catch (err) { if (generation.current === version) setError("Tasks could not refresh. " + err.message); }
  }, loading, null);
  useEffect(() => { setQueryDraft(q); }, [q]);
  useEffect(() => {
    const version = ++generation.current, controller = new AbortController();
    setLoading(true); setError(""); setData(null);
    api(path, { signal: controller.signal }).then(result => {
      if (generation.current !== version) return;
      if (page > Math.max(1, result.pages)) {
        const params = new URLSearchParams({ view, q, priority, page: Math.max(1, result.pages) });
        setSearch(params, { replace: true }); return;
      }
      setData(result);
    }).catch(err => { if (generation.current === version) setError(err.message); })
      .finally(() => { if (generation.current === version) setLoading(false); });
    return () => { generation.current = version + 1; controller.abort(); };
  }, [path, attempt, page, view, q, priority, setSearch]);
  function change(values) {
    const params = new URLSearchParams(search);
    params.delete("page");
    Object.entries(values).forEach(([key, value]) => value ? params.set(key, value) : params.delete(key));
    setToday(localDay()); setSearch(params);
  }
  return <Shell role="freelancer" eyebrow="YOUR PRIVATE WORKSPACE" title="My tasks"
    subtitle="Your next steps across all active projects. Only you can see these tasks."
    action={<Link className="button button-outline" to="/task-boards">Project task boards →</Link>}>
    <section className="panel my-tasks-panel">
      <div className="panel-heading"><div><p className="eyebrow">PLAN YOUR DAY</p><h2>Work across projects</h2><p className="form-help">Dates use your local calendar. Ended project tasks stay in their project boards.</p></div>
        <button className="button button-outline" disabled={loading || live.refreshing} onClick={() => { setToday(localDay()); setAttempt(value => value + 1); }}>Refresh tasks</button></div>
      <nav className="my-task-views" aria-label="Task views">{views.map(([value, label]) => <Link key={value} to={`/my-tasks?${new URLSearchParams({ view: value, ...(q ? { q } : {}), ...(priority ? { priority } : {}) })}`} aria-current={view === value ? "page" : undefined}>{label}<span>{data?.counts?.[value] ?? "—"}</span></Link>)}</nav>
      <form className="my-task-filters" aria-label="Filter my tasks" onSubmit={event => { event.preventDefault(); change({ q: queryDraft.trim() }); }}>
        <label>Search tasks<input type="search" maxLength={100} placeholder="Title, description or subtask" value={queryDraft} onChange={event => setQueryDraft(event.target.value)} /></label>
        <label>Priority<select value={priority} onChange={event => change({ priority: event.target.value })}><option value="">All priorities</option>{["low", "medium", "high", "urgent"].map(item => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></label>
        <button className="button button-dark">Search</button><button type="button" className="button button-outline" disabled={!q && !priority && !queryDraft} onClick={() => { setQueryDraft(""); change({ q: "", priority: "" }); }}>Clear filters</button>
      </form>
      <p className="task-live-status" role="status">{live.status === "live" ? "Live updates on" : "Live updates reconnecting"} · {data?.today || today}{live.refreshing ? " · Updating tasks…" : ""}</p>
      {error && <div className="message error" role="alert">{error} <button className="text-button" onClick={() => setAttempt(value => value + 1)}>Retry tasks</button></div>}
      {loading ? <p className="empty-state" role="status">Loading your tasks…</p> : data && (data.items.length ? <div className="my-task-list">{data.items.map(task => {
        const steps = task.checklist || [], checked = steps.filter(item => item.done).length;
        return <article className="my-task-row" key={task._id} aria-label={task.title}>
          <div className="my-task-main"><p className="task-project-name">{task.project.title}</p><h3><Link to={`/task-boards/${task.project._id}?task=${task._id}`}>{task.title}</Link></h3>
            <div className="my-task-meta"><span>{labels[task.status]}</span><span className={`task-priority task-priority-${task.priority}`}>{task.priority} priority</span>{steps.length > 0 && <span>{checked}/{steps.length} subtasks</span>}</div></div>
          <div className="my-task-dates"><span className={task.dueDate && task.dueDate < data.today && task.status !== "done" ? "task-date-overdue" : ""}>{task.dueDate ? `Due ${dateLabel(task.dueDate)}` : "No due date"}</span>
            {task.reminderAt && <small>{task.reminderSentAt ? "Reminder delivered" : `Reminder ${new Date(task.reminderAt).toLocaleString()}`}</small>}</div>
          <Link className="button button-outline" to={`/task-boards/${task.project._id}?task=${task._id}`}>Open task →</Link>
        </article>;
      })}</div> : <div className="empty-state"><h3>{view === "overdue" ? "No overdue tasks" : view === "today" ? "Nothing due today" : view === "upcoming" ? "No upcoming deadlines" : view === "done" ? "No completed tasks here yet" : "No open tasks here yet"}</h3><p>{q || priority ? "Try another search or clear the filters." : "Add tasks from an active project's board. Tasks without a due date appear in All open."}</p><Link className="button button-outline" to="/task-boards">Open task boards →</Link></div>)}
      {data && <Pagination {...data} loading={loading} label="tasks" onPage={next => { const params = new URLSearchParams(search); params.set("page", next); setSearch(params); }} />}
    </section>
  </Shell>;
}
