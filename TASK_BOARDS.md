# Private task boards: phases 1–3

Freelancers can open Task boards from the desktop/mobile workspace navigation, a project under My projects, or their assigned project's milestone workspace. Each assigned project has its own board with To do, In progress, Review and Done columns.

Tasks contain a required title (up to 120 characters), optional description (up to 4000 characters), priority (low/medium/high/urgent), optional due date and optional link to a milestone belonging to that project. Create or edit a task through the form; move it through the board using its Status selector. The full description is available by opening a task. An empty board starts with no manufactured tasks. Past due dates are allowed for recording existing work.

Task data is stored in the separate ProjectTask collection and survives refresh/sign-out. A task belongs to its creator and project. Every list, read and mutation requires an authenticated freelancer who is the project's current assigned freelancer. Clients, administrators, applicants and other freelancers cannot use these endpoints to read private tasks. Tasks are never embedded in project responses, public listings, client notifications or shared project activity. Reassignment removes the previous assignee's access and does not expose their private tasks to the new assignee.

In Progress projects allow planning changes, including while project terms/cancellation requests are being discussed. Completed and Cancelled project boards remain readable but reject edits and new tasks. Moving a task to Review/Done does not submit work, approve milestones, change project status, trigger payments or add verified work history. Client delivery/approval continues through the existing milestone workflow.

Saves lock the editor and duplicate clicks while a request is pending. Failed edits remain in the form. Updates carry a version checked by the server: a stale tab receives a conflict instead of overwriting newer edits. Refresh the board before editing a conflicted task again; copy any unsaved changes before closing the editor. A milestone removed by a project amendment is labelled as removed on the task; its link can be cleared or replaced when editing.

Project selection is paginated. A board loads 50 tasks at a time in creation order and explicitly shows how many are loaded; Load more tasks retrieves remaining work. Private live events refresh the loaded window when safe; Refresh board remains available as a manual retry.

## Phase 2: daily workflow

Move a task between columns by dragging its Move handle on desktop. The same handle supports left/right arrow keys, with focus restored after saving; status menus remain available on touch devices and keyboards. Drops change task status, not order within a column. A failed move leaves the task in its previous column and shows the error. Ended projects disable all moves and checklist edits.

Each task supports up to 30 titled subtasks/checklist steps, with a checkbox for completion. Add, rename, tick or remove steps in the editor and save them with the task; existing saved steps can also be checked directly on their card. New steps receive server IDs. Subtask progress is displayed separately, and checking every step does not automatically mark the parent task Done. A task explicitly marked Done can still show unchecked steps.

Search and filters can be expanded above the board. Search matches literal text in titles, descriptions and subtask titles. Status, priority and overdue filters combine on the server before counts and pagination; filters are preserved in the page URL and when loading more work. Column counts include all matching tasks, with an explicit notice when only some are loaded. Empty matches can be recovered with Clear filters.

Board progress always counts every parent task in this private project board, regardless of the active filters or loaded page: Done tasks / all tasks. Subtask progress has its own count and does not affect this percentage. An unfinished task is overdue when its due date precedes the board's local calendar day; a task due today or already Done is not overdue. The browser supplies that day at load/refresh/filter changes; API callers omitting it use UTC. Refresh a board left open overnight to update its date reference.

After a save/move/checklist change, the active filtered window and progress are refreshed from the server. A successful save followed by a failed refresh is reported as saved, with a request to refresh counts; it is not presented as a failed save. Existing task versions and private ownership protections still apply. Existing tasks without a checklist are returned with an empty list; no user data migration/reset is needed.

## Phase 3: across-project planning

My tasks in desktop/mobile navigation combines private tasks across currently assigned In Progress projects. All open includes undated tasks. Today includes unfinished tasks due on the supplied local day; Upcoming includes future due dates; Overdue excludes today, undated and Done tasks. Done shows completed tasks in active projects. Ended project tasks remain in read-only project boards. Search/priority filters run before counts and pagination; tab counts reflect those filters. Tasks sort by due date, with undated tasks last. Refresh tasks updates the date reference after midnight.

Open task and reminder links load the requested task directly, even beyond the board's loaded page or active filters. Saving retains board filters. Edits and moves append server-generated private activity atomically with the version-checked change. The latest 100 changes are retained. Older tasks begin with no invented history. History describes changed fields and status transitions rather than copying old description text.

The editor accepts one optional future reminder in browser local time and stores the instant in MongoDB. It creates one in-app notification; no email or browser notification permission is involved. Delivered reminders can be cleared or rescheduled. Done clears a reminder; reopening does not restore an old schedule. Ended/reassigned projects and suspended recipients are ineligible. Cancelled/replaced/no-longer-eligible reminder notifications are excluded from the notification list and unread count. Unique schedule tokens prevent duplicates across concurrent workers and retries, including a crash between notification creation and acknowledgement.

The normal backend scans at startup and every 30 seconds. Due reminders catch up after a restart. An offline/sleeping server cannot deliver until it runs again; this is not a precise alarm. Serverless deployment requires a compatible scheduler/worker adaptation. The task worker never queues email.

Private owner-only events refresh My tasks and boards, including after reconnect. An editor, save, drag or page load defers updates without discarding a draft. Stale saves still receive a conflict. Task events carry only a project ID and never go to clients. Login sessions remain in MongoDB Session with hashed cookie tokens and expiry; tasks/history live separately in ProjectTask. No private planning data is stored in localStorage.

## API

- `GET /api/task-boards?page=1&pageSize=12`: assigned projects with board access.
- `GET /api/task-boards/mine?view=open&today=YYYY-MM-DD&page=1&pageSize=20`: active-project tasks and counts for open/today/upcoming/overdue/done; optional q and priority.
- `GET /api/task-boards/:projectId/tasks/:taskId`: private task details, reminder delivery and recent activity, including tasks beyond the loaded page.
- `GET /api/task-boards/:projectId?page=1&pageSize=50`: project summary, current milestones, the owner's paginated private tasks, full matching column counts and whole-board progress. Optional `q`, `status`, `priority`, `due=overdue`, `today=YYYY-MM-DD` filters are validated.
- `POST /api/task-boards/:projectId/tasks`: create a task.
- `PATCH /api/task-boards/:projectId/tasks/:taskId`: update allowed fields with the loaded `version`. Optional `reminderAt` is null or an ISO UTC instant; changed non-null reminders must be in the future.

Existing sessions, CSRF checks and request limits apply. Task responses use private/no-store caching. Ownership cannot be supplied or changed through task payloads. Dates and milestone membership are checked on the server.

## Focused verification

From backend: `node --test taskBoards.test.js` uses a uniquely named disposable database and removes only that database. It covers ownership/privacy, persistence, invalid fields, cross-project milestones, stale updates, global filtering/progress, checklist identity/completion, paging, reassignment and ended projects. Frontend TaskBoard tests exercise create/move/edit failures, drag/keyboard movement, checklist changes, filters, read-only boards and navigation. These are functional checks, not a real-user pilot.

Phase 3 verification: `node --test taskBoards.test.js taskDaily.test.js liveUpdates.test.js` covers private daily views/counts, direct links, assignment/end-state eligibility, atomic bounded history, reminder validation, concurrent-worker deduplication, retry after partial delivery, notification visibility, no email delivery and private event routing. Frontend TaskBoard/MyTasks/LiveUpdates/apiSecurity suites cover deep links, local-time payloads, retries, filtering/paging and live changes deferred around open drafts. A disposable two-project browser preview additionally verified notification-to-task navigation, real cross-tab draft preservation, reminder rescheduling and 390 px layouts. No production deployment or real-user pilot is claimed.
