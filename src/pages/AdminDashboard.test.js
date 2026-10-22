import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminDashboard from "./AdminDashboard";
import { api } from "../api";
jest.mock("../api", () => ({ api: jest.fn() }));
jest.mock("../components/Shell", () => ({ children }) => <main>{children}</main>);
beforeEach(() => api.mockReset());
const result = (items, total = items.length, page = 1) => ({ items, total, page, pageSize: 12, pages: Math.ceil(total / 12) });

test("admin sees totals and must record a reason before suspending an account", async () => {
  let suspended = false;
  api.mockImplementation((path, options) => {
    if (path === "/admin/overview") return Promise.resolve({ users: 24, activeProjects: 3, completedProjects: 6, pendingCases: 2, suspended: suspended ? 1 : 0, hiddenListings: 0 });
    if (path.startsWith("/admin/users?")) return Promise.resolve(result([{ _id: "user-1", name: "Reported user", email: "person@example.test", role: "freelancer", suspended, moderationVersion: 4 }]));
    if (options?.method === "POST") { suspended = true; return Promise.resolve({ message: "Account suspended and existing sessions revoked." }); }
    return Promise.resolve(result([]));
  });
  render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Suspend account" }));
  const confirm = screen.getByRole("button", { name: "Confirm suspend account" });
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Decision reason"), { target: { value: "Repeated abusive messages were independently reviewed." } });
  fireEvent.click(confirm);
  expect(await screen.findByRole("status")).toHaveTextContent("sessions revoked");
  expect(api).toHaveBeenCalledWith("/admin/users/user-1/moderation", { method: "POST", body: JSON.stringify({ action: "suspend", reason: "Repeated abusive messages were independently reviewed.", version: 4 }) });
  expect(await screen.findByRole("button", { name: "Restore account" })).toBeInTheDocument();
});

test("record pagination loads later accounts and searching resets to the first page", async () => {
  api.mockImplementation(path => Promise.resolve(path === "/admin/overview" ? {} : path.startsWith("/admin/users?") ? result([{ _id: path.includes("page=2") ? "two" : "one", name: path.includes("page=2") ? "Second account" : "First account", email: "user@example.test", role: "client" }], 24, path.includes("page=2") ? 2 : 1) : result([])));
  render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Next accounts page" }));
  expect(await screen.findByText("Second account")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search records"), { target: { value: "First" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringMatching(/q=First.*page=1/)));
});
