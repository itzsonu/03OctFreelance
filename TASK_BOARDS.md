# Private task boards: phases 1 and 2

Freelancers can open Task boards from the desktop/mobile workspace navigation, a project under My projects, or their assigned project's milestone workspace. Each assigned project has its own board with To do, In progress, Review and Done columns.

Tasks contain a required title (up to 120 characters), optional description (up to 4000 characters), priority (low/medium/high/urgent), optional due date and optional link to a milestone belonging to that project. Create or edit a task through the form; move it through the board using its Status selector. The full description is available by opening a task. An empty board starts with no manufactured tasks. Past due dates are allowed for recording existing work.

Task data is stored in the separate ProjectTask collection and survives refresh/sign-out. A task belongs to its creator and project. Every list, read and mutation requires an authenticated freelancer who is the project's current assigned freelancer. Clients, administrators, applicants and other freelancers cannot use these endpoints to read private tasks. Tasks are never embedded in project responses, public listings, client notifications or shared project activity. Reassignment removes the previous assignee's access and does not expose their private tasks to the new assignee.

In Progress projects allow planning changes, including while project terms/cancellation requests are being discussed. Completed and Cancelled project boards remain readable but reject edits and new tasks. Moving a task to Review/Done does not submit work, approve milestones, change project status, trigger payments or add verified work history. Client delivery/approval continues through the existing milestone workflow.

Saves lock the editor and duplicate clicks while a request is pending. Failed edits remain in the form. Updates carry a version checked by the server: a stale tab receives a conflict instead of overwriting newer edits. Refresh the board before editing a conflicted task again; copy any unsaved changes before closing the editor. A milestone removed by a project amendment is labelled as removed on the task; its link can be cleared or replaced when editing.

Project selection is paginated. A board loads 50 tasks at a time in creation order and explicitly shows how many are loaded; Load more tasks retrieves remaining work. Refresh board retrieves changes from other tabs.

## Phase 2: daily workflow

Move a task between columns by dragging its Move handle on desktop. The same handle supports left/right arrow keys, with focus restored after saving; status menus remain available on touch devices and keyboards. Drops change task status, not order within a column. A failed move leaves the task in its previous column and shows the error. Ended projects disable all moves and checklist edits.

Each task supports up to 30 titled subtasks/checklist steps, with a checkbox for completion. Add, rename, tick or remove steps in the editor and save them with the task; existing saved steps can also be checked directly on their card. New steps receive server IDs. Subtask progress is displayed separately, and checking every step does not automatically mark the parent task Done. A task explicitly marked Done can still show unchecked steps.

Search and filters can be expanded above the board. Search matches literal text in titles, descriptions and subtask titles. Status, priority and overdue filters combine on the server before counts and pagination; filters are preserved in the page URL and when loading more work. Column counts include all matching tasks, with an explicit notice when only some are loaded. Empty matches can be recovered with Clear filters.

Board progress always counts every parent task in this private project board, regardless of the active filters or loaded page: Done tasks / all tasks. Subtask progress has its own count and does not affect this percentage. An unfinished task is overdue when its due date precedes the board's local calendar day; a task due today or already Done is not overdue. The browser supplies that day at load/refresh/filter changes; API callers omitting it use UTC. Refresh a board left open overnight to update its date reference.

After a save/move/checklist change, the active filtered window and progress are refreshed from the server. A successful save followed by a failed refresh is reported as saved, with a request to refresh counts; it is not presented as a failed save. Existing task versions and private ownership protections still apply. Existing tasks without a checklist are returned with an empty list; no user data migration/reset is needed.

Phase 3 still includes reminders, activity history, automatic cross-tab updates and the all-project task overview. These are not activated by this batch.

## API

- `GET /api/task-boards?page=1&pageSize=12`: assigned projects with board access.
- `GET /api/task-boards/:projectId?page=1&pageSize=50`: project summary, current milestones, the owner's paginated private tasks, full matching column counts and whole-board progress. Optional `q`, `status`, `priority`, `due=overdue`, `today=YYYY-MM-DD` filters are validated.
- `POST /api/task-boards/:projectId/tasks`: create a task.
- `PATCH /api/task-boards/:projectId/tasks/:taskId`: update allowed fields with the loaded `version`.

Existing sessions, CSRF checks and request limits apply. Task responses use private/no-store caching. Ownership cannot be supplied or changed through task payloads. Dates and milestone membership are checked on the server.

## Focused verification

From backend: `node --test taskBoards.test.js` uses a uniquely named disposable database and removes only that database. It covers ownership/privacy, persistence, invalid fields, cross-project milestones, stale updates, global filtering/progress, checklist identity/completion, paging, reassignment and ended projects. Frontend TaskBoard tests exercise create/move/edit failures, drag/keyboard movement, checklist changes, filters, read-only boards and navigation. These are functional checks, not a real-user pilot.
