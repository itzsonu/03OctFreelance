# Private task boards: phase 1

Freelancers can open Task boards from the desktop/mobile workspace navigation, a project under My projects, or their assigned project's milestone workspace. Each assigned project has its own board with To do, In progress, Review and Done columns.

Tasks contain a required title (up to 120 characters), optional description (up to 4000 characters), priority (low/medium/high/urgent), optional due date and optional link to a milestone belonging to that project. Create or edit a task through the form; move it through the board using its Status selector. The full description is available by opening a task. An empty board starts with no manufactured tasks. Past due dates are allowed for recording existing work.

Task data is stored in the separate ProjectTask collection and survives refresh/sign-out. A task belongs to its creator and project. Every list, read and mutation requires an authenticated freelancer who is the project's current assigned freelancer. Clients, administrators, applicants and other freelancers cannot use these endpoints to read private tasks. Tasks are never embedded in project responses, public listings, client notifications or shared project activity. Reassignment removes the previous assignee's access and does not expose their private tasks to the new assignee.

In Progress projects allow planning changes, including while project terms/cancellation requests are being discussed. Completed and Cancelled project boards remain readable but reject edits and new tasks. Moving a task to Review/Done does not submit work, approve milestones, change project status, trigger payments or add verified work history. Client delivery/approval continues through the existing milestone workflow.

Saves lock the editor and duplicate clicks while a request is pending. Failed edits remain in the form. Updates carry a version checked by the server: a stale tab receives a conflict instead of overwriting newer edits. Refresh the board before editing a conflicted task again; copy any unsaved changes before closing the editor. A milestone removed by a project amendment is labelled as removed on the task; its link can be cleared or replaced when editing.

Project selection is paginated. A board loads 50 tasks at a time in creation order and explicitly shows how many are loaded; Load more tasks retrieves remaining work. Column counts describe loaded tasks. Refresh board retrieves changes from other tabs. Phase 1 does not include automatic cross-tab task updates, drag-and-drop, subtasks, search, filters, reminders or an all-project task overview; these are later phases.

## API

- `GET /api/task-boards?page=1&pageSize=12`: assigned projects with board access.
- `GET /api/task-boards/:projectId?page=1&pageSize=50`: project summary, current milestones and the owner's paginated private tasks.
- `POST /api/task-boards/:projectId/tasks`: create a task.
- `PATCH /api/task-boards/:projectId/tasks/:taskId`: update allowed fields with the loaded `version`.

Existing sessions, CSRF checks and request limits apply. Task responses use private/no-store caching. Ownership cannot be supplied or changed through task payloads. Dates and milestone membership are checked on the server.

## Focused verification

From backend: `node --test taskBoards.test.js` uses a uniquely named disposable database and removes only that database. It covers ownership/privacy, persistence, invalid fields, cross-project milestones, stale updates, paging, reassignment and ended projects. Frontend TaskBoard tests exercise actual create/move/edit failures, read-only boards and navigation. These are functional checks, not a real-user pilot.
