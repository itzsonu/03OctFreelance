import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ClientDashboard from "./ClientDashboard";
import { api, subscribeUpdates } from "../api";
jest.mock("../components/NotificationCenter", () => () => null);

jest.mock("../api", () => ({
  api: jest.fn(), subscribeUpdates: jest.fn(() => () => {}), currentUser: () => ({ id: "client-1", name: "Asha" }), signOut: jest.fn(),
}));

test("shows urgent project signals and a link to the project", async () => {
  api.mockResolvedValue([{ _id: "project-1", title: "Dashboard redesign", status: "In Progress", budget: 5000, deadline: "2026-09-26", milestones: [{ status: "active" }], insights: { level: "urgent", percent: 0, reasons: ["Deadline passed 1 day ago."] }, outlook: { status: "overdue", headline: "Deadline has passed", approved: 0, total: 1, paceDays: null, projectedDate: null, signals: [], nextAction: "Review the timeline." } }]);
  render(<MemoryRouter><ClientDashboard /></MemoryRouter>);
  expect(await screen.findByText("What needs attention")).toBeInTheDocument();
  expect(screen.getByText("Deadline passed 1 day ago.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open project →" })).toHaveAttribute("href", "/milestones/project-1");
  expect(screen.getByRole("heading", { name: "How the work is moving" })).toBeInTheDocument();
  expect(screen.getByText("Deadline has passed")).toBeInTheDocument();
});

test("refreshes the client workspace when a project update arrives", async () => {
  api.mockReset();
  subscribeUpdates.mockClear();
  let projectRequests = 0;
  api.mockImplementation(path => path === "/profile/me" ? Promise.resolve({ company: { name: "", overview: "" } }) : Promise.resolve(projectRequests++ === 0 ? [] : [{ _id: "project-2", title: "Fresh project", status: "Open", budget: 1000, deadline: "2030-12-31", milestones: [] }]));
  render(<MemoryRouter><ClientDashboard /></MemoryRouter>);
  expect(await screen.findByText("Your first project starts here")).toBeInTheDocument();
  await act(async () => { subscribeUpdates.mock.calls[0][0]({ type: "project", projectId: "project-2" }); });
  expect(await screen.findByText("Fresh project")).toBeInTheDocument();
});

test("client can update the public company information on open jobs", async () => {
  api.mockReset();
  api.mockImplementation((path, options) => {
    if (path === "/projects/mine") return Promise.resolve([]);
    if (path === "/profile/me" && options?.method === "PUT") return Promise.resolve({ company: { name: "Northstar Studio", overview: "A product design team." } });
    if (path === "/profile/me") return Promise.resolve({ company: { name: "", overview: "" } });
    return Promise.resolve([]);
  });
  render(<MemoryRouter><ClientDashboard /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText("Company name"), { target: { value: "Northstar Studio" } });
  fireEvent.change(screen.getByLabelText("Overview"), { target: { value: "A product design team." } });
  fireEvent.click(screen.getByRole("button", { name: "Save company details" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/profile/me", expect.objectContaining({ method: "PUT", body: JSON.stringify({ companyName: "Northstar Studio", companyOverview: "A product design team." }) })));
  expect(await screen.findByText("Company information saved.")).toBeInTheDocument();
});
