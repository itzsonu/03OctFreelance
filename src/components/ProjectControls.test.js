import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProjectControls from "./ProjectControls";
import ProjectForm from "./ProjectForm";
import { api } from "../api";
jest.mock("../api", () => ({ api: jest.fn() }));

const client = { id: "client-1", role: "client" };
const project = { _id: "project-1", __v: 4, status: "Open", title: "Original project", description: "Build a responsive dashboard with clear project delivery requirements.", category: "Web Development", requiredSkills: ["React", "CSS"], budget: 1000, deadline: "2030-12-31", hasExplicitDependencies: true, milestones: [{ _id: "step-1", title: "Design", description: "Create initial design", payment: 400, dueDate: "2030-12-20", dependsOn: [] }, { _id: "step-2", title: "Build", description: "Build the interface", payment: 600, dueDate: "2030-12-30", dependsOn: ["step-1"] }] };
beforeEach(() => { api.mockReset(); });

test("closing hiring sends the observed version and refreshes the project", async () => {
  const refresh = jest.fn();
  api.mockResolvedValue({ message: "Hiring closed." });
  render(<ProjectControls project={project} user={client} onChanged={refresh} />);
  fireEvent.click(screen.getByRole("button", { name: "Close hiring" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/projects/project-1/hiring", { method: "POST", body: JSON.stringify({ version: 4, action: "close" }) }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
});

test("unassigned cancellation requires a reason and explicit confirmation", async () => {
  api.mockResolvedValue({ message: "Project cancelled." });
  render(<ProjectControls project={project} user={client} onChanged={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel unassigned project" }));
  expect(api).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Confirm project cancellation" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Cancellation reason"), { target: { value: "Our project is no longer required." } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm project cancellation" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/projects/project-1/cancellations", expect.objectContaining({ body: JSON.stringify({ version: 4, reason: "Our project is no longer required." }) })));
});

const pending = { ...project, status: "In Progress", freelancer: { _id: "freelancer-1" }, pendingCancellation: "cancel-1", cancellationRequests: [{ _id: "cancel-1", requestedBy: "client-1", requesterName: "Client", reason: "We need to end the project by agreement.", status: "Pending", createdAt: "2026-10-21T00:00:00Z" }] };

test("requester can withdraw but cannot approve their own cancellation", async () => {
  api.mockResolvedValue({ message: "Request withdrawn." });
  render(<ProjectControls project={pending} user={client} onChanged={jest.fn()} />);
  expect(screen.queryByRole("button", { name: "Agree to cancel project" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Cancellation response"), { target: { value: "Our project can continue as agreed." } });
  fireEvent.click(screen.getByRole("button", { name: "Withdraw cancellation request" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/projects/project-1/cancellations/cancel-1/respond", expect.objectContaining({ body: JSON.stringify({ version: 4, action: "withdraw", response: "Our project can continue as agreed." }) })));
});

test("other participant can decline and stale-request errors remain visible", async () => {
  api.mockRejectedValue(new Error("Project changed. Reload before trying again."));
  render(<ProjectControls project={pending} user={{ id: "freelancer-1", role: "freelancer" }} onChanged={jest.fn()} />);
  expect(screen.queryByRole("button", { name: "Withdraw cancellation request" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Cancellation response"), { target: { value: "Please continue with the original agreement." } });
  fireEvent.click(screen.getByRole("button", { name: "Decline cancellation" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Project changed");
});

test("cancelled projects retain history and expose no hiring or cancellation actions", () => {
  render(<ProjectControls project={{ ...pending, status: "Cancelled", pendingCancellation: null, cancellationRequests: [{ ...pending.cancellationRequests[0], status: "Accepted" }] }} user={client} onChanged={jest.fn()} />);
  expect(screen.getByText("Cancellation history (1)")).toBeInTheDocument();
  expect(screen.getByText(/agreement, submissions, files/)).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("project edit preserves milestone dependencies and uses PATCH with version", async () => {
  const saved = jest.fn();
  api.mockImplementation(path => Promise.resolve(path.endsWith("/listing") ? { project: { ...project, title: "Updated title" } } : { available: false }));
  render(<ProjectForm initialProject={project} onClose={jest.fn()} onCreated={saved} />);
  expect(screen.getByDisplayValue("Original project")).toBeInTheDocument();
  expect(screen.getByRole("checkbox")).toBeChecked();
  fireEvent.change(screen.getByLabelText("Project title"), { target: { value: "Updated title" } });
  fireEvent.click(screen.getByRole("button", { name: "Save project changes" }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  const call = api.mock.calls.find(([path]) => path.endsWith("/listing"));
  expect(call[1].method).toBe("PATCH");
  expect(JSON.parse(call[1].body)).toMatchObject({ version: 4, title: "Updated title", requiredSkills: ["React", "CSS"], milestones: [{ dependsOn: [] }, { dependsOn: [0] }] });
});
