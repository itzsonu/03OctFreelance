import React, { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import Shell from "../components/Shell";
import Pagination from "../components/Pagination";
import useDialogAccessibility from "../useDialogAccessibility";

const columns = [["todo", "To do"], ["in_progress", "In progress"], ["review", "Review"], ["done", "Done"]];
const priorities = ["low", "medium", "high", "urgent"];
const blank = () => ({ title: "", description: "", status: "todo", priority: "medium", dueDate: "", milestoneId: "" });
const dateLabel = value => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export default function TaskBoard() {
  const { projectId } = useParams();
  const [listPage, setListPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(null);
  const [draft, setDraft] = useState(blank);
  const [editorError, setEditorError] = useState("");
  const generation = useRef(0);
  const mutationLock = useRef(false);
  const moreLock = useRef(false);
  const editorFeedback = useRef(null);
  const dialogRef = useDialogAccessibility(() => { if (!mutationLock.current) setEditor(null); }, Boolean(editor));

  useEffect(() => {
    const version = ++generation.current;
    const controller = new AbortController();
    mutationLock.current = false; moreLock.current = false;
    setLoading(true); setData(null); setLoadError(""); setActionError(null); setNotice(""); setEditor(null); setBusy(false); setMoreLoading(false);
    const path = projectId ? `/task-boards/${projectId}?page=1&pageSize=50` : `/task-boards?page=${listPage}&pageSize=12`;
    api(path, { signal: controller.signal }).then(result => {
      if (generation.current !== version) return;
      if (!projectId && listPage > Math.max(1, result.pages)) { setListPage(Math.max(1, result.pages)); return; }
      setData(result);
    }).catch(error => { if (generation.current === version) setLoadError(error.message); })
      .finally(() => { if (generation.current === version) setLoading(false); });
    return () => { generation.current += 1; controller.abort(); };
  }, [projectId, listPage, attempt]);

  useEffect(() => { if (editorError) editorFeedback.current?.focus(); }, [editorError]);

  async function loadMore() {
    if (moreLock.current || !data || data.page >= data.pages) return;
    const version = generation.current;
    moreLock.current = true; setMoreLoading(true); setActionError(null);
    try {
      const next = await api(`/task-boards/${projectId}?page=${data.page + 1}&pageSize=50`);
      if (version !== generation.current) return;
      setData(current => ({ ...next, items: [...current.items, ...next.items.filter(item => !current.items.some(existing => existing._id === item._id))] }));
    } catch (error) { if (version === generation.current) setActionError({ message: error.message }); }
    finally { if (version === generation.current) { moreLock.current = false; setMoreLoading(false); } }
  }

  function openEditor(task = null) {
    const milestoneId = task?.milestoneId && data.project.milestones.some(item => item._id === task.milestoneId) ? task.milestoneId : "";
    setDraft(task ? { title: task.title, description: task.description, status: task.status, priority: task.priority, dueDate: task.dueDate, milestoneId } : blank());
    setEditor({ task }); setEditorError(""); setNotice("");
  }

  async function writeTask(task, fields, fromEditor) {
    if (mutationLock.current) return;
    const version = generation.current;
    mutationLock.current = true; setBusy(true); setEditorError(""); setActionError(null); setNotice("");
    try {
      const result = await api(`/task-boards/${projectId}/tasks${task ? `/${task._id}` : ""}`, {
        method: task ? "PATCH" : "POST",
        body: JSON.stringify({ ...fields, ...(task ? { version: task.version } : {}) }),
      });
      if (version !== generation.current) return;
      setData(current => {
        const total = current.total + (task ? 0 : 1);
        return { ...current, total, pages: Math.ceil(total / current.pageSize), items: task ? current.items.map(item => item._id === task._id ? result.task : item) : [...current.items, result.task] };
      });
      if (fromEditor) setEditor(null);
      setNotice(task ? "Task updated." : "Task created.");
    } catch (error) {
      if (version !== generation.current) return;
      if (fromEditor) setEditorError(error.message);
      else setActionError({ taskId: task._id, message: error.message });
    } finally { if (version === generation.current) { mutationLock.current = false; setBusy(false); } }
  }

  const staleData = Boolean(data && (projectId ? data.project?._id !== projectId : data.project));
  const project = staleData ? null : data?.project;
  const editable = Boolean(project?.editable);
  const tasks = projectId ? data?.items || [] : [];
  return <Shell role="freelancer" eyebrow="YOUR PRIVATE WORKSPACE" title={project?.title || (projectId ? "Project task board" : "Task boards")}
    subtitle="Plan your daily work, one task at a time. Your task details are private to you."
    action={<Link className="button button-outline" to={projectId ? "/task-boards" : "/freelancer-dashboard"}>{projectId ? "← All task boards" : "← Find work"}</Link>}>
    {loadError && <div className="message error" role="alert">{loadError}</div>}
    {notice && <p className="message success" role="status">{notice}</p>}
    {actionError && !actionError.taskId && <p className="message error" role="alert">{actionError.message}</p>}
    {loading || staleData ? <p className="empty-state" role="status">Loading your {projectId ? "task board" : "projects"}…</p> : !data ?
      <div className="empty-state"><p>Your {projectId ? "board" : "projects"} could not be loaded.</p><button className="button button-outline" onClick={() => setAttempt(value => value + 1)}>Retry task boards</button></div> :
      !projectId ? <section className="panel task-projects" aria-label="Your project task boards">
        <div className="panel-heading"><div><p className="eyebrow">CHOOSE A PROJECT</p><h2>Your assigned projects</h2></div><span className="count-pill">{data.total}</span></div>
        {data.items.length ? <div className="task-project-grid">{data.items.map(item => <article className="task-project-card" key={item._id}>
          <span className={`status status-${item.status.toLowerCase().replaceAll(" ", "-")}`}>{item.status}</span><h3>{item.title}</h3>
          <p>Project target: {dateLabel(item.deadline)}</p><Link className="button button-outline" to={`/task-boards/${item._id}`}>Open task board →</Link>
        </article>)}</div> : <div className="empty-state"><h3>Your first board starts with an assigned project</h3><p>Once you and a client agree an offer, its private task board appears here.</p><Link className="button button-dark" to="/freelancer-dashboard?view=applications">View my applications →</Link></div>}
        <Pagination {...data} loading={loading} onPage={setListPage} label="projects" />
      </section> : <>
        <section className="panel task-board-toolbar" aria-label="Task board controls">
          <div><span className={`status status-${project.status.toLowerCase().replaceAll(" ", "-")}`}>{project.status}</span><p>Use Review for your own review stage. Submit deliveries and get client approvals in the milestone workspace.</p>
            {!editable && <p className="task-readonly" role="status">This project has ended. You can read its tasks here.</p>}</div>
          <div className="task-board-actions"><Link className="button button-outline" to={`/milestones/${projectId}`}>Project milestones ↗</Link>
            <button className="button button-outline" disabled={busy || moreLoading || Boolean(editor)} onClick={() => setAttempt(value => value + 1)}>Refresh board</button>
            {editable && <button className="button button-dark" disabled={busy} onClick={() => openEditor()}>+ Add task</button>}</div>
        </section>
        <p className="task-board-count">{tasks.length === data.total ? `${data.total} task${data.total === 1 ? "" : "s"}` : `Showing ${tasks.length} of ${data.total} tasks. Load more below to see the remaining work.`}</p>
        <div className="task-board-grid">{columns.map(([status, label]) => {
          const items = tasks.filter(task => task.status === status);
          return <section className={`task-column task-column-${status}`} aria-label={`${label} tasks`} key={status}>
            <div className="task-column-heading"><h2>{label}</h2><span>{items.length}</span></div>
            {items.length ? items.map(task => {
              const milestone = project.milestones.find(item => item._id === task.milestoneId);
              return <article className="task-card" key={task._id} aria-label={task.title}>
                <span className={`task-priority task-priority-${task.priority}`}>{task.priority} priority</span>
                <h3><button className="task-title" onClick={() => openEditor(task)} disabled={busy} aria-label={`${editable ? "Edit" : "View"} task: ${task.title}`}>{task.title}</button></h3>
                {task.description && <p className="task-description">{task.description}</p>}
                {task.dueDate && <p className="task-date">Due {dateLabel(task.dueDate)}</p>}
                {task.milestoneId && <p className="task-milestone">Milestone: {milestone?.title || "Removed from project"}</p>}
                <label className="task-status-control">Status<select aria-label={`Status for ${task.title}`} value={task.status} disabled={!editable || busy} onChange={event => writeTask(task, { status: event.target.value }, false)}>{columns.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
                {actionError?.taskId === task._id && <p className="task-error" role="alert">{actionError.message}</p>}
              </article>;
            }) : <p className="task-column-empty">No {data.total > tasks.length ? "loaded " : ""}tasks here yet.</p>}
          </section>;
        })}</div>
        {data.page < data.pages && <div className="task-load-more"><button className="button button-outline" disabled={moreLoading || busy} onClick={loadMore}>{moreLoading ? "Loading tasks…" : "Load more tasks"}</button></div>}
      </>}
    {editor && project && <div className="modal-overlay"><div className="dialog task-editor" role="dialog" aria-modal="true" aria-labelledby="task-editor-title" ref={dialogRef} tabIndex={-1}>
      <div className="dialog-heading"><div><p className="eyebrow">PRIVATE TASK</p><h2 id="task-editor-title">{editor.task ? editable ? "Edit task" : "Task details" : "Create a task"}</h2></div><button className="icon-button" aria-label="Close task editor" disabled={busy} onClick={() => setEditor(null)}>×</button></div>
      {editorError && <div ref={editorFeedback} tabIndex={-1} className="message error" role="alert">{editorError}</div>}
      <form onSubmit={event => { event.preventDefault(); if (editable) writeTask(editor.task, draft, true); }}>
        <fieldset className="task-editor-fields stack-form" disabled={busy || !editable}>
          <label>Task title<input autoComplete="off" required maxLength={120} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>Description<textarea rows={4} maxLength={4000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} placeholder="What needs to be done?" /></label>
          <div className="form-row"><label>Status<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}>{columns.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
            <label>Priority<select value={draft.priority} onChange={event => setDraft({ ...draft, priority: event.target.value })}>{priorities.map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label></div>
          <div className="form-row"><label>Due date <small>Optional</small><input type="date" value={draft.dueDate} onChange={event => setDraft({ ...draft, dueDate: event.target.value })} /></label>
            <label>Linked milestone <small>Optional</small><select value={draft.milestoneId} onChange={event => setDraft({ ...draft, milestoneId: event.target.value })}><option value="">No milestone</option>{project.milestones.map(item => <option key={item._id} value={item._id}>{item.title}</option>)}</select></label></div>
          {editor.task?.milestoneId && !project.milestones.some(item => item._id === editor.task.milestoneId) && <p className="form-help">The linked milestone was removed from this project. Saving will use your new milestone choice.</p>}
        </fieldset>
        <div className="task-editor-actions"><button type="button" className="button button-outline" disabled={busy} onClick={() => setEditor(null)}>{editable ? "Cancel" : "Close"}</button>{editable && <button className="button button-dark" disabled={busy}>{busy ? "Saving task…" : editor.task ? "Save task" : "Create task"}</button>}</div>
      </form>
    </div></div>}
  </Shell>;
}
