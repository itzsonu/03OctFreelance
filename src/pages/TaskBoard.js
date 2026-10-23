import React, { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import Shell from "../components/Shell";
import Pagination from "../components/Pagination";
import useDialogAccessibility from "../useDialogAccessibility";
import TaskChecklistEditor from "../components/TaskChecklistEditor";
import useTaskUpdates from "../useTaskUpdates";
import { toLocalMinute } from "../taskDates";

const columns = [["todo", "To do"], ["in_progress", "In progress"], ["review", "Review"], ["done", "Done"]];
const priorities = ["low", "medium", "high", "urgent"];
const blank = () => ({ title: "", description: "", status: "todo", priority: "medium", dueDate: "", milestoneId: "", checklist: [], reminderAt: null });
const dateLabel = value => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const localDay = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const makeDraft = (task, project) => task ? { title: task.title, description: task.description, status: task.status, priority: task.priority, dueDate: task.dueDate, milestoneId: project.milestones.some(item => item._id === task.milestoneId) ? task.milestoneId : "", checklist: (task.checklist || []).map(item => ({ ...item })), reminderAt: task.reminderAt || null } : blank();
const overdue = (task, today) => Boolean(task.dueDate && task.dueDate < today && task.status !== "done");

export default function TaskBoard() {
  const { projectId } = useParams();
  const [search, setSearch] = useSearchParams();
  const q = search.get("q") || "", statusFilter = search.get("status") || "", priorityFilter = search.get("priority") || "", dueFilter = search.get("due") || "";
  const filterKey = new URLSearchParams(Object.entries({ q, status: statusFilter, priority: priorityFilter, due: dueFilter }).filter(([, value]) => value)).toString();
  const linkTaskId = search.get("task") || "";
  const openedLink = useRef("");
  const [openingTask, setOpeningTask] = useState(false);
  const [queryDraft, setQueryDraft] = useState(q);
  const [showFilters, setShowFilters] = useState(Boolean(filterKey));
  const [today, setToday] = useState(localDay);
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
  const draggedTask = useRef(null);
  const [draggingId, setDraggingId] = useState(null);
  const [dropColumn, setDropColumn] = useState(null);
  const keyboardTask = useRef(null);
  const boardCount = useRef(null);
  const editorOpen = useRef(false); editorOpen.current = Boolean(editor);
  const refreshRevision = useRef(0);
  const dialogRef = useDialogAccessibility(() => { if (!mutationLock.current) closeEditor(); }, Boolean(editor));
  const live = useTaskUpdates(async () => {
    const version = generation.current, revision = refreshRevision.current;
    try {
      const next = projectId ? await refreshWindow(data?.page || 1) : await api(`/task-boards?page=${listPage}&pageSize=12`);
      if (generation.current !== version) return;
      if (revision !== refreshRevision.current || mutationLock.current || moreLock.current || editorOpen.current || draggedTask.current) return false;
      setData(next);
    } catch (error) { if (generation.current === version) setActionError({ message: "Live refresh failed. Use Refresh board to retry. " + error.message }); }
  }, loading || busy || moreLoading || Boolean(editor) || Boolean(draggingId) || openingTask, projectId);

  useEffect(() => {
    const version = ++generation.current;
    const controller = new AbortController();
    mutationLock.current = false; moreLock.current = false; draggedTask.current = null; setDraggingId(null); setDropColumn(null);
    setLoading(true); setData(null); setLoadError(""); setActionError(null); setNotice(""); setEditor(null); setBusy(false); setMoreLoading(false);
    const path = projectId ? `/task-boards/${projectId}?page=1&pageSize=50&today=${today}${filterKey ? `&${filterKey}` : ""}` : `/task-boards?page=${listPage}&pageSize=12`;
    api(path, { signal: controller.signal }).then(result => {
      if (generation.current !== version) return;
      if (!projectId && listPage > Math.max(1, result.pages)) { setListPage(Math.max(1, result.pages)); return; }
      setData(result);
    }).catch(error => { if (generation.current === version) setLoadError(error.message); })
      .finally(() => { if (generation.current === version) setLoading(false); });
    return () => { generation.current += 1; controller.abort(); };
  }, [projectId, listPage, attempt, filterKey, today]);

  useEffect(() => { if (editorError) editorFeedback.current?.focus(); }, [editorError]);
  useEffect(() => { setQueryDraft(q); }, [q]);
  useEffect(() => { if (filterKey) setShowFilters(true); }, [filterKey]);
  useEffect(() => {
    if (busy || !keyboardTask.current) return;
    (document.querySelector(`[data-move-task="${keyboardTask.current}"]`) || boardCount.current)?.focus();
    keyboardTask.current = null;
  }, [busy]);

  const readyProject = projectId && data?.project?._id === projectId ? data.project : null;
  useEffect(() => {
    if (!linkTaskId) { openedLink.current = ""; return; }
    const key = `${projectId}:${linkTaskId}`;
    if (!readyProject || loading || openedLink.current === key) return;
    const controller = new AbortController(), version = generation.current;
    setOpeningTask(true);
    api(`/task-boards/${projectId}/tasks/${encodeURIComponent(linkTaskId)}`, { signal: controller.signal }).then(result => {
      if (generation.current !== version || controller.signal.aborted) return;
      openedLink.current = key;
      setDraft(makeDraft(result.task, readyProject)); setEditor({ task: result.task }); setEditorError("");
    }).catch(error => { if (generation.current === version && !controller.signal.aborted) { openedLink.current = key; setActionError({ message: error.message }); } })
      .finally(() => { if (!controller.signal.aborted) setOpeningTask(false); });
    return () => { controller.abort(); setOpeningTask(false); };
  }, [linkTaskId, projectId, readyProject, loading]);

  function closeEditor() {
    setEditor(null);
    if (linkTaskId) { const params = new URLSearchParams(search); params.delete("task"); setSearch(params, { replace: true }); }
  }
  function boardPath(page) { return `/task-boards/${projectId}?page=${page}&pageSize=50&today=${today}${filterKey ? `&${filterKey}` : ""}`; }
  function updateFilters(changes) {
    const params = new URLSearchParams(filterKey);
    Object.entries(changes).forEach(([key, value]) => value ? params.set(key, value) : params.delete(key));
    setToday(localDay()); setSearch(params);
  }
  async function refreshWindow(pageCount) {
    const first = await api(boardPath(1));
    const last = Math.min(pageCount, Math.max(1, first.pages));
    const rest = await Promise.all(Array.from({ length: last - 1 }, (_, index) => api(boardPath(index + 2))));
    return { ...first, page: last, items: [...new Map([first, ...rest].flatMap(result => result.items).map(item => [item._id, item])).values()] };
  }
  function finishDrag() { draggedTask.current = null; setDraggingId(null); setDropColumn(null); }
  function startDrag(event, task) {
    if (mutationLock.current || editor || !data?.project?.editable) { event.preventDefault(); return; }
    draggedTask.current = task; setDraggingId(task._id);
    event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", task._id);
  }
  function dropTask(event, status) {
    const task = draggedTask.current;
    if (!task || mutationLock.current || !data?.project?.editable) return;
    event.preventDefault(); finishDrag();
    if (task.status !== status) writeTask(task, { status }, false);
  }
  function moveWithKeyboard(event, task) {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const index = columns.findIndex(([value]) => value === task.status) + (event.key === "ArrowLeft" ? -1 : 1);
    if (columns[index]) { keyboardTask.current = task._id; writeTask(task, { status: columns[index][0] }, false); }
  }

  async function loadMore() {
    if (moreLock.current || !data || data.page >= data.pages) return;
    const version = generation.current;
    refreshRevision.current++; moreLock.current = true; setMoreLoading(true); setActionError(null);
    try {
      const next = await api(boardPath(data.page + 1));
      if (version !== generation.current) return;
      setData(current => ({ ...next, items: [...current.items, ...next.items.filter(item => !current.items.some(existing => existing._id === item._id))] }));
    } catch (error) { if (version === generation.current) setActionError({ message: error.message }); }
    finally { if (version === generation.current) { moreLock.current = false; setMoreLoading(false); } }
  }

  function openEditor(task = null) {
    setDraft(makeDraft(task, data.project));
    setEditor({ task }); setEditorError(""); setNotice("");
  }

  async function writeTask(task, fields, fromEditor) {
    if (mutationLock.current) return;
    const version = generation.current;
    const loadedPages = data.page;
    let saved = false;
    refreshRevision.current++; mutationLock.current = true; setBusy(true); setEditorError(""); setActionError(null); setNotice("");
    try {
      const result = await api(`/task-boards/${projectId}/tasks${task ? `/${task._id}` : ""}`, {
        method: task ? "PATCH" : "POST",
        body: JSON.stringify({ ...fields, ...(task ? { version: task.version } : {}) }),
      });
      if (version !== generation.current) return;
      saved = true;
      setData(current => {
        const total = current.total + (task ? 0 : 1);
        return { ...current, total, pages: Math.ceil(total / current.pageSize), items: task ? current.items.map(item => item._id === task._id ? result.task : item) : [...current.items, result.task] };
      });
      if (fromEditor) closeEditor();
      setNotice(task ? "Task updated." : filterKey ? "Task created. Active filters may hide it." : "Task created.");
      const refreshed = await refreshWindow(loadedPages);
      if (version === generation.current) setData(refreshed);
    } catch (error) {
      if (version !== generation.current) return;
      if (saved) setActionError({ message: "Task saved, but the board could not refresh. Refresh the board to update results and progress." });
      else if (fromEditor) setEditorError(error.message);
      else setActionError({ taskId: task._id, message: error.message });
    } finally { if (version === generation.current) { mutationLock.current = false; setBusy(false); } }
  }

  const staleData = Boolean(data && (projectId ? data.project?._id !== projectId : data.project));
  const project = staleData ? null : data?.project;
  const editable = Boolean(project?.editable);
  const tasks = projectId ? data?.items || [] : [];
  const boardToday = data?.today || today;
  const summary = data?.summary;
  const completion = summary?.total ? Math.round(summary.done / summary.total * 100) : 0;
  return <Shell role="freelancer" eyebrow="YOUR PRIVATE WORKSPACE" title={project?.title || (projectId ? "Project task board" : "Task boards")}
    subtitle="Plan your daily work, one task at a time. Your task details are private to you."
    action={<Link className="button button-outline" to={projectId ? "/task-boards" : "/freelancer-dashboard"}>{projectId ? "← All task boards" : "← Find work"}</Link>}>
    {projectId && <p className="task-live-status" role="status">{live.status === "live" ? "Live updates on" : "Live updates reconnecting"}{live.pending && editor ? " · Updates waiting until you close the editor" : live.refreshing ? " · Updating board…" : ""}</p>}
    {openingTask && <p role="status">Opening task…</p>}
    {loadError && <div className="message error" role="alert">{loadError}</div>}
    {notice && <p className="message success" role="status">{notice}</p>}
    {actionError && !actionError.taskId && <p className="message error" role="alert">{actionError.message}</p>}
    {projectId && <details className="panel task-filters" open={showFilters} onToggle={event => setShowFilters(event.currentTarget.open)}><summary>Search and filters{filterKey ? " · Active" : ""}</summary><form aria-label="Filter tasks" onSubmit={event => { event.preventDefault(); updateFilters({ q: queryDraft.trim() }); }}>
      <fieldset disabled={busy || moreLoading || Boolean(editor)}>
        <label>Search tasks<input maxLength={100} type="search" placeholder="Title, description or subtask" value={queryDraft} onChange={event => setQueryDraft(event.target.value)} /></label>
        <label>Task status<select value={statusFilter} onChange={event => updateFilters({ status: event.target.value })}><option value="">All statuses</option>{columns.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Task priority<select value={priorityFilter} onChange={event => updateFilters({ priority: event.target.value })}><option value="">All priorities</option>{priorities.map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label>
        <label>Due date filter<select value={dueFilter} onChange={event => updateFilters({ due: event.target.value })}><option value="">Any due date</option><option value="overdue">Overdue tasks</option></select></label>
        <button className="button button-dark">Search tasks</button><button type="button" className="button button-outline" disabled={!filterKey && !queryDraft} onClick={() => { setQueryDraft(""); setToday(localDay()); setSearch({}); }}>Clear filters</button>
      </fieldset>
    </form></details>}
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
          <div className="task-board-actions"><Link className="button button-outline" to="/my-tasks">My tasks →</Link><Link className="button button-outline" to={`/milestones/${projectId}`}>Project milestones ↗</Link>
            <button className="button button-outline" disabled={busy || moreLoading || Boolean(editor)} onClick={() => { setToday(localDay()); setAttempt(value => value + 1); }}>Refresh board</button>
            {editable && <button className="button button-dark" disabled={busy} onClick={() => openEditor()}>+ Add task</button>}</div>
        </section>
        {summary && <section className="panel task-board-progress" aria-label="Project task progress"><div><strong>{summary.done} of {summary.total} tasks done</strong><span>{completion}% complete across this board</span></div><progress aria-label="Task completion" value={summary.done} max={summary.total || 1} /><span className="task-overdue-total">{summary.overdue} overdue</span></section>}
        {editable && <p className="task-move-help">Drag a task using its move handle, or choose a status. On a focused move handle, use the left/right arrow keys.</p>}
        {busy && !editor && <p className="task-saving" role="status">Saving task changes…</p>}
        <p className="task-board-count" ref={boardCount} tabIndex={-1}>{tasks.length === data.total ? `${data.total} ${filterKey ? "matching " : ""}task${data.total === 1 ? "" : "s"}` : `Showing ${tasks.length} of ${data.total} ${filterKey ? "matching " : ""}tasks. Column counts include all matches; load more below.`}</p>
        {data.total === 0 && filterKey && <p className="task-no-matches" role="status">No matching tasks. Adjust your search or clear the filters.</p>}
        <div className="task-board-grid">{columns.map(([status, label]) => {
          const items = tasks.filter(task => task.status === status);
          const count = data.counts?.[status] ?? items.length;
          return <section className={`task-column task-column-${status}${dropColumn === status ? " task-drop-target" : ""}`} aria-label={`${label} tasks`} key={status}
            onDragOver={event => { if (draggedTask.current && editable && !busy) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropColumn(status); } }}
            onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropColumn(null); }} onDrop={event => dropTask(event, status)}>
            <div className="task-column-heading"><h2>{label}</h2><span>{count}</span></div>
            {items.length ? items.map(task => {
              const milestone = project.milestones.find(item => item._id === task.milestoneId);
              const checklist = task.checklist || [], checked = checklist.filter(item => item.done).length;
              return <article className={`task-card${draggingId === task._id ? " task-is-dragging" : ""}`} key={task._id} aria-label={task.title}>
                <div className="task-card-top"><span className={`task-priority task-priority-${task.priority}`}>{task.priority} priority</span>
                  {editable && <button type="button" className="task-drag-handle" data-move-task={task._id} aria-label={`Move task: ${task.title}`} title="Drag to a column or use left/right arrows" draggable={!busy} disabled={busy} onDragStart={event => startDrag(event, task)} onDragEnd={finishDrag} onKeyDown={event => moveWithKeyboard(event, task)}>⠿ <span>Move</span></button>}</div>
                <h3><button className="task-title" onClick={() => openEditor(task)} disabled={busy} aria-label={`${editable ? "Edit" : "View"} task: ${task.title}`}>{task.title}</button></h3>
                {task.description && <p className="task-description">{task.description}</p>}
                {task.dueDate && <p className={`task-date${overdue(task, boardToday) ? " task-date-overdue" : ""}`}>{overdue(task, boardToday) && <strong>Overdue · </strong>}Due {dateLabel(task.dueDate)}</p>}
                {task.reminderAt && <p className="task-reminder">{task.reminderSentAt ? "Reminder delivered" : `Reminder: ${new Date(task.reminderAt).toLocaleString()}`}</p>}
                {task.milestoneId && <p className="task-milestone">Milestone: {milestone?.title || "Removed from project"}</p>}
                {checklist.length > 0 && <details className="task-card-checklist"><summary>Subtasks · {checked}/{checklist.length} complete</summary><progress aria-label={`Subtask progress for ${task.title}`} value={checked} max={checklist.length} />
                  {checklist.map(item => <label key={item._id}><input type="checkbox" checked={item.done} disabled={!editable || busy} onChange={event => writeTask(task, { checklist: checklist.map(step => step._id === item._id ? { ...step, done: event.target.checked } : step) }, false)} /><span>{item.title}</span></label>)}
                  {task.status === "done" && checked < checklist.length && <small>Some subtasks remain unchecked.</small>}
                </details>}
                <label className="task-status-control">Status<select aria-label={`Status for ${task.title}`} value={task.status} disabled={!editable || busy} onChange={event => writeTask(task, { status: event.target.value }, false)}>{columns.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
                {actionError?.taskId === task._id && <p className="task-error" role="alert">{actionError.message}</p>}
              </article>;
            }) : <p className="task-column-empty">{count > 0 ? `${count} matching tasks. Load more below.` : filterKey ? "No matching tasks here." : "No tasks here yet."}</p>}
          </section>;
        })}</div>
        {data.page < data.pages && <div className="task-load-more"><button className="button button-outline" disabled={moreLoading || busy} onClick={loadMore}>{moreLoading ? "Loading tasks…" : "Load more tasks"}</button></div>}
      </>}
    {editor && project && <div className="modal-overlay"><div className="dialog task-editor" role="dialog" aria-modal="true" aria-labelledby="task-editor-title" ref={dialogRef} tabIndex={-1}>
      <div className="dialog-heading"><div><p className="eyebrow">PRIVATE TASK</p><h2 id="task-editor-title">{editor.task ? editable ? "Edit task" : "Task details" : "Create a task"}</h2></div><button className="icon-button" aria-label="Close task editor" disabled={busy} onClick={closeEditor}>×</button></div>
      {editorError && <div ref={editorFeedback} tabIndex={-1} className="message error" role="alert">{editorError}</div>}
      <form onSubmit={event => { event.preventDefault(); if (editable) writeTask(editor.task, draft, true); }}>
        <fieldset className="task-editor-fields stack-form" disabled={busy || !editable}>
          <label>Task title<input autoComplete="off" required maxLength={120} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>Description<textarea rows={4} maxLength={4000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} placeholder="What needs to be done?" /></label>
          <div className="form-row"><label>Status<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value, ...(event.target.value === "done" ? { reminderAt: null } : {}) })}>{columns.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
            <label>Priority<select value={draft.priority} onChange={event => setDraft({ ...draft, priority: event.target.value })}>{priorities.map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label></div>
          <div className="form-row"><label>Due date <small>Optional</small><input type="date" value={draft.dueDate} onChange={event => setDraft({ ...draft, dueDate: event.target.value })} /></label>
            <label>Linked milestone <small>Optional</small><select value={draft.milestoneId} onChange={event => setDraft({ ...draft, milestoneId: event.target.value })}><option value="">No milestone</option>{project.milestones.map(item => <option key={item._id} value={item._id}>{item.title}</option>)}</select></label></div>
          {editor.task?.milestoneId && !project.milestones.some(item => item._id === editor.task.milestoneId) && <p className="form-help">The linked milestone was removed from this project. Saving will use your new milestone choice.</p>}
          <label>Remind me <small>Optional · Your local time</small><input type="datetime-local" value={toLocalMinute(draft.reminderAt)} disabled={draft.status === "done"} onChange={event => setDraft({ ...draft, reminderAt: event.target.value ? new Date(event.target.value).toISOString() : null })} /></label>
          <p className="form-help task-reminder-help">{draft.status === "done" ? "Done tasks have no active reminder." : editor.task?.reminderSentAt && draft.reminderAt === editor.task.reminderAt ? "This reminder was delivered. Choose a new future time to remind yourself again." : "One in-app notification at the selected time. If the server is offline, it arrives after the server resumes. No email is sent."}</p>
          {draft.reminderAt && <button type="button" className="text-button" onClick={() => setDraft({ ...draft, reminderAt: null })}>Remove reminder</button>}
          <TaskChecklistEditor items={draft.checklist} onChange={checklist => setDraft(current => ({ ...current, checklist }))} />
        </fieldset>
        <div className="task-editor-actions"><button type="button" className="button button-outline" disabled={busy} onClick={closeEditor}>{editable ? "Cancel" : "Close"}</button>{editable && <button className="button button-dark" disabled={busy}>{busy ? "Saving task…" : editor.task ? "Save task" : "Create task"}</button>}</div>
      </form>
      {editor.task && <section className="task-activity" aria-label="Task activity"><h3>Activity history</h3><p className="form-help">Private to you · Latest 100 changes</p>{editor.task.activity?.length ? <ol>{[...editor.task.activity].reverse().map((item, index) => <li key={item._id || index}><span>{item.summary}</span><time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time></li>)}</ol> : <p className="form-help">No recorded changes yet. History starts with changes made after this update.</p>}</section>}
    </div></div>}
  </Shell>;
}
