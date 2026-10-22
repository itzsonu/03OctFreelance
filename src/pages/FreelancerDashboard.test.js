import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FreelancerDashboard from "./FreelancerDashboard";
import { api, subscribeUpdates } from "../api";
jest.mock("../components/NotificationCenter", () => () => null);

jest.mock("../api", () => ({
  api: jest.fn(),
  subscribeUpdates: jest.fn(() => () => {}),
  currentUser: () => ({ id: "freelancer-1", name: "Freelancer" }),
  signOut: jest.fn(),
}));

const publicJobs = projects => ({ projects, total: projects.length, page: 1, pageSize: 12, pages: 1 });

test("proposal is sent with the required message", async () => {
  api.mockImplementation(path => {
    if (path === "/projects/all") return Promise.resolve([{ _id: "project-123", title: "Brand design", budget: 5000, deadline: "2026-12-01", status: "Open", client: { name: "Client" }, milestones: [{ _id: "step-1" }] }]);
    if (path === "/projects/public") return Promise.resolve(publicJobs([{ _id: "project-123", title: "Brand design", category: "Design & Creative", budget: 5000, deadline: "2026-12-01", status: "Open", requiredSkills: ["Figma"] }]));
    if (path === "/projects/public/project-123") return Promise.resolve({ id: "project-123", title: "Brand design", category: "Design & Creative", description: "A complete brand identity with responsive visual assets.", budget: 5000, deadline: "2026-12-01", requiredSkills: ["Figma"], milestones: [{ id: "step-1", title: "Concepts", payment: 5000 }] });
    if (path === "/applications/mine") return Promise.resolve([]);
    if (path === "/projects/saved") return Promise.resolve([]);
    if (path === "/invitations/mine") return Promise.resolve([]);
    if (path === "/applications") return Promise.resolve({});
    return Promise.reject(new Error("Unexpected request"));
  });
  render(<MemoryRouter><FreelancerDashboard /></MemoryRouter>);
  await screen.findByText("Brand design");
  fireEvent.click(screen.getByRole("button", { name: /view brief & apply/i }));
  fireEvent.change(await screen.findByPlaceholderText(/relevant experience/i), { target: { value: "I can deliver the identity in clear stages." } });
  fireEvent.change(screen.getByLabelText("Proposed price"), { target: { value: "5000" } });
  fireEvent.change(screen.getByLabelText("Delivery estimate (days)"), { target: { value: "21" } });
  fireEvent.change(screen.getByPlaceholderText("https://example.com/relevant-work"), { target: { value: "https://example.test/portfolio" } });
  fireEvent.change(screen.getByPlaceholderText("What would you like the client to know?"), { target: { value: "Have you built brand systems?" } });
  fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "Yes, for three product launches." } });
  expect(screen.getByRole("button", { name: /send proposal/i })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: /send proposal/i }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/applications", expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ projectId: "project-123", proposal: "I can deliver the identity in clear stages.", proposedPrice: 5000, deliveryEstimateDays: 21, portfolioLinks: ["https://example.test/portfolio"], answers: [{ question: "Have you built brand systems?", answer: "Yes, for three product launches." }] }),
  })));
});

test("freelancer can edit and withdraw a pending proposal", async () => {
  const application = { _id: "application-7", proposal: "I can build the first version and support review.", proposedPrice: 7000, deliveryEstimateDays: 18, portfolioLinks: [], answers: [], status: "PENDING", createdAt: "2026-09-27T00:00:00Z", project: { _id: "project-7", title: "Portal", status: "Open" }, offers: [], currentOfferState: "NONE" };
  api.mockReset();
  api.mockImplementation((path, options) => {
    if (path === "/projects/all") return Promise.resolve([]);
    if (path === "/projects/public") return Promise.resolve(publicJobs([]));
    if (path === "/applications/mine") return Promise.resolve([application]);
    if (path === "/projects/saved" || path === "/invitations/mine") return Promise.resolve([]);
    if (path === "/applications/application-7" && options?.method === "PATCH") return Promise.resolve({ invalidatedOffer: true });
    if (path === "/applications/application-7/withdraw" && options?.method === "POST") return Promise.resolve({});
    return Promise.reject(new Error(`Unexpected request ${path}`));
  });
  render(<MemoryRouter><FreelancerDashboard /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("tab", { name: /my applications/i }));
  fireEvent.click(screen.getByRole("button", { name: "Edit proposal" }));
  fireEvent.change(screen.getByLabelText("Proposed price"), { target: { value: "6500" } });
  fireEvent.click(screen.getByRole("button", { name: "Save proposal" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/applications/application-7", expect.objectContaining({
    method: "PATCH",
    body: JSON.stringify({ proposal: application.proposal, proposedPrice: 6500, deliveryEstimateDays: 18, portfolioLinks: [], answers: [] }),
  })));
  expect(await screen.findByText("Proposal updated. The previous offer is now stale.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/applications/application-7/withdraw", { method: "POST", body: "{}" }));
  expect(await screen.findByText("Proposal withdrawn.")).toBeInTheDocument();
});

test("an invitation can be opened to send a proposal", async () => {
  api.mockReset();
  api.mockImplementation(path => {
    if (path === "/projects/all" || path === "/applications/mine" || path === "/projects/saved") return Promise.resolve([]);
    if (path === "/invitations/mine") return Promise.resolve([{ _id: "invite-1", status: "PENDING", note: "Your React experience would fit this project.", client: { name: "Client" }, project: { _id: "project-2", title: "Build a portal", status: "Open", budget: 12000, requiredSkills: ["React"], milestones: [] } }]);
    return Promise.resolve({});
  });
  render(<MemoryRouter><FreelancerDashboard /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("tab", { name: /invitations/i }));
  expect(screen.getByText("Build a portal")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /view & propose/i }));
  expect(screen.getByRole("dialog", { name: "Build a portal" })).toBeInTheDocument();
});

test("freelancer can save a project and find it in Saved", async () => {
  api.mockReset();
  api.mockImplementation(path => {
    if (path === "/projects/all") return Promise.resolve([{ _id: "project-123", title: "Brand design", budget: 5000, status: "Open", requiredSkills: [], milestones: [] }]);
    if (path === "/projects/public") return Promise.resolve(publicJobs([{ _id: "project-123", title: "Brand design", budget: 5000, status: "Open", requiredSkills: [] }]));
    if (path === "/projects/saved" || path === "/applications/mine" || path === "/invitations/mine") return Promise.resolve([]);
    if (path === "/projects/saved/project-123") return Promise.resolve({ saved: true });
    return Promise.reject(new Error("Unexpected request"));
  });
  render(<MemoryRouter><FreelancerDashboard /></MemoryRouter>);
  await screen.findByText("Brand design");
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/projects/saved/project-123", { method: "PUT" }));
  fireEvent.click(screen.getByRole("tab", { name: /saved/i }));
  expect(screen.getByText("Brand design")).toBeInTheDocument();
});

test("new marketplace work appears without a page reload", async () => {
  api.mockReset();
  subscribeUpdates.mockClear();
  api.mockImplementation(path => path === "/projects/all" ? Promise.resolve([{ _id: "project-1", title: "First project", status: "Open", requiredSkills: [], milestones: [] }]) : path === "/projects/public" ? Promise.resolve(publicJobs([{ _id: "project-1", title: "First project", status: "Open", requiredSkills: [] }])) : Promise.resolve([]));
  render(<MemoryRouter><FreelancerDashboard /></MemoryRouter>);
  expect(await screen.findByText("First project")).toBeInTheDocument();
  api.mockImplementation(path => path === "/projects/all" ? Promise.resolve([{ _id: "project-1", title: "First project", status: "Open", requiredSkills: [], milestones: [] }, { _id: "project-2", title: "New project", status: "Open", requiredSkills: [], milestones: [] }]) : path === "/projects/public" ? Promise.resolve(publicJobs([{ _id: "project-1", title: "First project", status: "Open", requiredSkills: [] }, { _id: "project-2", title: "New project", status: "Open", requiredSkills: [] }])) : Promise.resolve([]));
  await act(async () => { subscribeUpdates.mock.calls[0][0]({ type: "marketplace", projectId: null }); });
  expect(await screen.findByText("New project")).toBeInTheDocument();
});

test("discovery filters are restored from the URL and sent to the public API", async () => {
  api.mockReset();
  api.mockImplementation(path => path.startsWith("/projects/public") ? Promise.resolve(publicJobs([])) : Promise.resolve([]));
  render(<MemoryRouter initialEntries={["/freelancer-dashboard?category=Design%20%26%20Creative&minBudget=10000&page=2"]}><FreelancerDashboard /></MemoryRouter>);
  await screen.findByText("Showing 0–0 of 0 open projects");
  expect(api).toHaveBeenCalledWith("/projects/public?category=Design+%26+Creative&minBudget=10000&page=2");
  expect(screen.getByLabelText("Category")).toHaveValue("Design & Creative");
  expect(screen.getByLabelText("Minimum budget")).toHaveValue(10000);
});
