import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TaskBoard from "./TaskBoard";
import { api } from "../api";
jest.mock("../api", () => ({ api: jest.fn(), currentUser: () => ({ id: "owner", name: "Freelancer" }), signOut: jest.fn() }));
jest.mock("../components/NotificationCenter", () => () => null);
beforeEach(() => api.mockReset());
const project = { _id: "p1", title: "Booking dashboard", status: "In Progress", editable: true, milestones: [{ _id: "m1", title: "Build interface" }] };
const task = { _id: "t1", title: "Build booking form", description: "Use accessible fields.", status: "todo", priority: "high", dueDate: "2030-12-20", milestoneId: "m1", version: 0 };
const result = (items = [], changes = {}) => ({ project, items, total: items.length, pages: items.length ? 1 : 0, page: 1, pageSize: 50, summary: { total: items.length, done: items.filter(item => item.status === "done").length, overdue: 0 }, counts: Object.fromEntries(["todo", "in_progress", "review", "done"].map(status => [status, items.filter(item => item.status === status).length])), ...changes });
const mount = (path = "/task-boards/p1") => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/task-boards/:projectId?" element={<TaskBoard />} /></Routes></MemoryRouter>);

test("create, link and move a task through the private board", async () => {
  let records = [];
  api.mockImplementation((path, options) => {
    if (options?.method === "POST") { records = [task]; return Promise.resolve({ task }); }
    if (options?.method === "PATCH") { records = [{ ...task, status: "in_progress", version: 1 }]; return Promise.resolve({ task: records[0] }); }
    return Promise.resolve(result(records));
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "+ Add task" }));
  const dialog = screen.getByRole("dialog", { name: "Create a task" });
  fireEvent.change(within(dialog).getByLabelText("Task title"), { target: { value: task.title } });
  fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: task.description } });
  fireEvent.change(within(dialog).getByLabelText("Priority"), { target: { value: "high" } });
  fireEvent.change(within(dialog).getByLabelText(/Due date/), { target: { value: task.dueDate } });
  fireEvent.change(within(dialog).getByLabelText(/Linked milestone/), { target: { value: "m1" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create task" }));
  const card = await screen.findByRole("article", { name: task.title });
  expect(api).toHaveBeenCalledWith("/task-boards/p1/tasks", { method: "POST", body: JSON.stringify({ title: task.title, description: task.description, status: "todo", priority: "high", dueDate: task.dueDate, milestoneId: "m1", checklist: [] }) });
  expect(within(card).getByText("Milestone: Build interface")).toBeInTheDocument();
  fireEvent.change(within(card).getByLabelText(`Status for ${task.title}`), { target: { value: "in_progress" } });
  await waitFor(() => expect(within(screen.getByRole("region", { name: "In progress tasks" })).getByRole("article", { name: task.title })).toBeInTheDocument());
  expect(api).toHaveBeenCalledWith("/task-boards/p1/tasks/t1", { method: "PATCH", body: JSON.stringify({ status: "in_progress", version: 0 }) });
});

test("failed edits retain the draft and pending saves cannot be duplicated", async () => {
  let reject;
  api.mockResolvedValueOnce(result([task])).mockReturnValueOnce(new Promise((resolve, fail) => { reject = fail; }));
  mount(); fireEvent.click(await screen.findByRole("button", { name: `Edit task: ${task.title}` }));
  const title = screen.getByLabelText("Task title"); fireEvent.change(title, { target: { value: "Keep my unsaved draft" } });
  const save = screen.getByRole("button", { name: "Save task", exact: true });
  fireEvent.click(save); fireEvent.submit(save.closest("form"));
  expect(title).toBeDisabled(); expect(api.mock.calls.filter(call => call[1]?.method === "PATCH")).toHaveLength(1);
  await act(async () => reject(new Error("This task changed in another tab.")));
  expect(title).toBeEnabled(); expect(title).toHaveValue("Keep my unsaved draft"); expect(screen.getByRole("alert")).toHaveFocus();
});

test("ended projects show readable task details without editing or moving", async () => {
  api.mockResolvedValue(result([task], { project: { ...project, status: "Completed", editable: false } }));
  mount();
  const card = await screen.findByRole("article", { name: task.title });
  expect(screen.queryByRole("button", { name: "+ Add task" })).not.toBeInTheDocument();
  expect(within(card).getByLabelText(`Status for ${task.title}`)).toBeDisabled();
  fireEvent.click(within(card).getByRole("button", { name: `View task: ${task.title}` }));
  expect(screen.getByLabelText("Task title")).toBeDisabled(); expect(screen.getByRole("dialog", { name: "Task details" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save task", exact: true })).not.toBeInTheDocument();
});

test("task boards load more without hiding work and recover from an initial failure", async () => {
  api.mockRejectedValueOnce(new Error("Board connection interrupted"))
    .mockResolvedValueOnce(result([task], { total: 2, pages: 2 }))
    .mockResolvedValueOnce(result([{ ...task, _id: "t2", title: "Second task" }], { total: 2, pages: 2, page: 2 }));
  mount(); fireEvent.click(await screen.findByRole("button", { name: "Retry task boards" }));
  fireEvent.click(await screen.findByRole("button", { name: "Load more tasks" }));
  expect(await screen.findByRole("article", { name: "Second task" })).toBeInTheDocument();
  expect(screen.getByRole("article", { name: task.title })).toBeInTheDocument();
  expect(screen.getByText("2 tasks")).toBeInTheDocument();
});

test("a project is reachable from the board picker and the milestone workspace", async () => {
  api.mockImplementation(path => Promise.resolve(path.includes("/p1?") ? result() : { items: [{ ...project, deadline: "2030-12-31" }], total: 1, pages: 1, page: 1 }));
  mount("/task-boards"); fireEvent.click(await screen.findByRole("link", { name: "Open task board →" }));
  expect(await screen.findByRole("link", { name: "Project milestones ↗" })).toHaveAttribute("href", "/milestones/p1");
  expect(screen.getByRole("link", { name: "← All task boards" })).toHaveAttribute("href", "/task-boards");
});

test("dragging and keyboard moves persist status and restore keyboard focus", async () => {
  let saved = { ...task };
  api.mockImplementation((path, options) => {
    if (options?.method === "PATCH") { saved = { ...saved, ...JSON.parse(options.body), version: saved.version + 1 }; return Promise.resolve({ task: saved }); }
    return Promise.resolve(result([saved]));
  });
  mount();
  const transfer = { setData: jest.fn() };
  fireEvent.dragStart(await screen.findByRole("button", { name: `Move task: ${task.title}` }), { dataTransfer: transfer });
  fireEvent.dragOver(screen.getByRole("region", { name: "In progress tasks" }), { dataTransfer: transfer });
  fireEvent.drop(screen.getByRole("region", { name: "In progress tasks" }), { dataTransfer: transfer });
  await waitFor(() => expect(within(screen.getByRole("region", { name: "In progress tasks" })).getByRole("button", { name: `Move task: ${task.title}` })).toBeEnabled());
  const handle = screen.getByRole("button", { name: `Move task: ${task.title}` }); handle.focus(); fireEvent.keyDown(handle, { key: "ArrowRight" });
  await waitFor(() => expect(within(screen.getByRole("region", { name: "Review tasks" })).getByRole("button", { name: `Move task: ${task.title}` })).toHaveFocus());
  expect(saved.status).toBe("review"); expect(saved.version).toBe(2);
});

test("a failed drop leaves the task in its original column", async () => {
  api.mockResolvedValueOnce(result([task])).mockRejectedValueOnce(new Error("Connection interrupted"));
  mount();
  const transfer = { setData: jest.fn() };
  fireEvent.dragStart(await screen.findByRole("button", { name: `Move task: ${task.title}` }), { dataTransfer: transfer });
  fireEvent.drop(screen.getByRole("region", { name: "Done tasks" }), { dataTransfer: transfer });
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
  expect(within(screen.getByRole("region", { name: "To do tasks" })).getByRole("article", { name: task.title })).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Done tasks" })).queryByRole("article")).not.toBeInTheDocument();
});

test("subtasks can be renamed, replaced and checked without completing the parent", async () => {
  let saved = { ...task, checklist: [{ _id: "c1", title: "First step", done: false }, { _id: "c2", title: "Remove me", done: false }] };
  api.mockImplementation((path, options) => {
    if (options?.method === "PATCH") {
      const fields = JSON.parse(options.body);
      saved = { ...saved, ...fields, version: saved.version + 1, checklist: fields.checklist.map((item, index) => ({ ...item, _id: item._id || `new-${index}` })) };
      return Promise.resolve({ task: saved });
    }
    return Promise.resolve(result([saved]));
  });
  mount(); fireEvent.click(await screen.findByRole("button", { name: `Edit task: ${task.title}` }));
  fireEvent.change(screen.getByLabelText("Subtask 1", { exact: true }), { target: { value: "Review requirements" } });
  fireEvent.click(screen.getByRole("button", { name: "Remove subtask 2" }));
  fireEvent.click(screen.getByRole("button", { name: "+ Add subtask" }));
  fireEvent.change(screen.getByLabelText("Subtask 2", { exact: true }), { target: { value: "Ship interface" } });
  fireEvent.click(screen.getByLabelText("Complete subtask 1", { exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Save task", exact: true }));
  fireEvent.click(await screen.findByText("Subtasks · 1/2 complete"));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Ship interface" }));
  expect(await screen.findByText("Subtasks · 2/2 complete")).toBeInTheDocument();
  expect(saved.status).toBe("todo"); expect(saved.checklist[0]._id).toBe("c1");
  expect(screen.getByText("0 of 1 tasks done")).toBeInTheDocument();
});

test("filtered pagination preserves query fields and progress counts the whole board", async () => {
  const second = { ...task, _id: "t2", title: "Remote task on later page" };
  const summary = { total: 5, done: 2, overdue: 2 };
  api.mockImplementation(path => Promise.resolve(result(path.includes("page=2") ? [second] : [task], { total: 2, pages: 2, page: path.includes("page=2") ? 2 : 1, counts: { todo: 2, in_progress: 0, review: 0, done: 0 }, summary, today: "2031-01-01" })));
  mount("/task-boards/p1?q=remote&priority=high&due=overdue");
  expect(await screen.findByText("2 of 5 tasks done")).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Task completion" })).toHaveAttribute("max", "5");
  expect(screen.getByRole("searchbox", { name: "Search tasks" })).toHaveValue("remote");
  fireEvent.click(screen.getByRole("button", { name: "Load more tasks" }));
  expect(await screen.findByRole("article", { name: second.title })).toBeInTheDocument();
  expect(api).toHaveBeenCalledWith(expect.stringMatching(/page=2.*q=remote&priority=high&due=overdue/));
  expect(screen.getByText("2 matching tasks")).toBeInTheDocument();
});

test("moving a task out of the active filter refreshes results and overall completion", async () => {
  let saved = { ...task };
  api.mockImplementation((path, options) => {
    if (options?.method === "PATCH") { saved = { ...saved, status: "done", version: 1 }; return Promise.resolve({ task: saved }); }
    return Promise.resolve(result(saved.status === "todo" ? [saved] : [], { summary: { total: 1, done: saved.status === "done" ? 1 : 0, overdue: 0 } }));
  });
  mount("/task-boards/p1?status=todo");
  fireEvent.change(await screen.findByRole("combobox", { name: `Status for ${task.title}` }), { target: { value: "done" } });
  expect(await screen.findByText("No matching tasks. Adjust your search or clear the filters.")).toBeInTheDocument();
  expect(screen.queryByRole("article", { name: task.title })).not.toBeInTheDocument();
  expect(screen.getByText("1 of 1 tasks done")).toBeInTheDocument();
});

test("a saved task with a failed refresh is clearly reported as saved", async () => {
  api.mockResolvedValueOnce(result([task])).mockResolvedValueOnce({ task: { ...task, priority: "urgent", version: 1 } }).mockRejectedValueOnce(new Error("Refresh unavailable"));
  mount(); fireEvent.click(await screen.findByRole("button", { name: `Edit task: ${task.title}` }));
  fireEvent.change(screen.getByRole("combobox", { name: "Priority", exact: true }), { target: { value: "urgent" } });
  fireEvent.click(screen.getByRole("button", { name: "Save task", exact: true }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Task saved, but the board could not refresh");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByText("urgent priority")).toBeInTheDocument();
});
