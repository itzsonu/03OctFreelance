import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import MyTasks from "./MyTasks";
import { api, subscribeUpdates } from "../api";
jest.mock("../api", () => ({ api: jest.fn(), subscribeUpdates: jest.fn(() => () => {}), currentUser: () => ({ name: "Freelancer" }), signOut: jest.fn() }));
jest.mock("../components/NotificationCenter", () => () => null);
const task = { _id: "t99", title: "Review article", project: { _id: "p2", title: "Writing project" }, status: "todo", priority: "high", dueDate: "2030-03-10", checklist: [{ done: false }] };
const response = (items = [task], overrides = {}) => ({ items, total: items.length, page: 1, pages: 1, pageSize: 20, counts: { open: 3, today: 1, upcoming: 1, overdue: 1, done: 2 }, today: "2030-03-10", ...overrides });
const mount = (path = "/my-tasks") => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/my-tasks" element={<MyTasks />} /></Routes></MemoryRouter>);
beforeEach(() => { api.mockReset(); subscribeUpdates.mockClear(); });

test("daily views, filters and pagination use the server and deep-link the correct project", async () => {
  api.mockImplementation(path => {
    const params = new URLSearchParams(path.split("?")[1]);
    return Promise.resolve(response([task], { page: Number(params.get("page")), pages: 2, total: 21 }));
  });
  mount();
  expect(await screen.findByRole("article", { name: "Review article" })).toHaveTextContent("Writing project");
  expect(screen.getByRole("link", { name: "Open task →" })).toHaveAttribute("href", "/task-boards/p2?task=t99");
  expect(within(screen.getByRole("navigation", { name: "Task views" })).getByRole("link", { name: /All open/ })).toHaveAttribute("aria-current", "page");
  fireEvent.click(screen.getByRole("link", { name: /^Today/ }));
  await waitFor(() => expect(api.mock.calls.at(-1)[0]).toContain("view=today"));
  await screen.findByRole("article", { name: task.title });
  fireEvent.change(screen.getByRole("searchbox", { name: "Search tasks" }), { target: { value: "article" } });
  fireEvent.click(screen.getByRole("button", { name: "Search", exact: true }));
  await waitFor(() => expect(api.mock.calls.at(-1)[0]).toContain("q=article"));
  await screen.findByRole("article", { name: task.title });
  fireEvent.click(screen.getByRole("button", { name: "Next tasks page" }));
  await waitFor(() => expect(api.mock.calls.at(-1)[0]).toContain("page=2"));
  expect(api.mock.calls.at(-1)[0]).toContain("q=article");
});

test("live changes refresh the current view and failures have a retry", async () => {
  api.mockRejectedValueOnce(new Error("Offline"));
  mount("/my-tasks?view=overdue");
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
  api.mockResolvedValue(response([]));
  fireEvent.click(screen.getByRole("button", { name: "Retry tasks" }));
  expect(await screen.findByRole("heading", { name: "No overdue tasks" })).toBeInTheDocument();
  api.mockResolvedValue(response([task]));
  await act(async () => subscribeUpdates.mock.calls.at(-1)[0]({ type: "tasks", projectId: "p2" }));
  expect(await screen.findByRole("article", { name: task.title })).toBeInTheDocument();
});
