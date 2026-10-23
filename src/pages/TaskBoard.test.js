import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TaskBoard from "./TaskBoard";
import { api } from "../api";
jest.mock("../api", () => ({ api: jest.fn(), currentUser: () => ({ id: "owner", name: "Freelancer" }), signOut: jest.fn() }));
jest.mock("../components/NotificationCenter", () => () => null);
beforeEach(() => api.mockReset());
const project = { _id: "p1", title: "Booking dashboard", status: "In Progress", editable: true, milestones: [{ _id: "m1", title: "Build interface" }] };
const task = { _id: "t1", title: "Build booking form", description: "Use accessible fields.", status: "todo", priority: "high", dueDate: "2030-12-20", milestoneId: "m1", version: 0 };
const result = (items = [], changes = {}) => ({ project, items, total: items.length, pages: items.length ? 1 : 0, page: 1, pageSize: 50, ...changes });
const mount = (path = "/task-boards/p1") => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/task-boards/:projectId?" element={<TaskBoard />} /></Routes></MemoryRouter>);

test("create, link and move a task through the private board", async () => {
  api.mockImplementation((path, options) => Promise.resolve(options?.method === "POST" ? { task } : options?.method === "PATCH" ? { task: { ...task, status: "in_progress", version: 1 } } : result()));
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
  expect(api).toHaveBeenCalledWith("/task-boards/p1/tasks", { method: "POST", body: JSON.stringify({ title: task.title, description: task.description, status: "todo", priority: "high", dueDate: task.dueDate, milestoneId: "m1" }) });
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
