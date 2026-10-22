import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProjectChanges from "./ProjectChanges";
import { api } from "../api";
jest.mock("../api", () => ({ api: jest.fn() }));
const project = { _id: "project-1", __v: 5, status: "In Progress", description: "The existing agreed scope.", budget: 1000, deadline: "2030-12-31", hasExplicitDependencies: true, milestones: [{ _id: "step-1", title: "Approved design", description: "Completed", payment: 400, dueDate: "2026-01-01", status: "completed", dependsOn: [] }, { _id: "step-2", title: "Delivery", description: "Implement the design", payment: 600, dueDate: "2030-12-20", status: "active", dependsOn: ["step-1"] }] };
const terms = { scope: "Proposed revised scope and delivery.", amount: 1000, deliveryDate: "2030-12-31", milestones: [{ title: "Delivery", description: "Build the interface", payment: 1000, dependsOn: [], dueDate: "2030-12-20" }] };
beforeEach(() => api.mockReset());

test("editor preserves approved steps and sends the version observed before editing", async () => {
  api.mockResolvedValue({ message: "Change request sent." });
  const saved = jest.fn();
  const { rerender } = render(<ProjectChanges project={project} user={{ id: "client-1" }} onChanged={saved} />);
  fireEvent.click(screen.getByRole("button", { name: "Propose project change" }));
  expect(screen.getByDisplayValue("Approved design")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Reason for change"), { target: { value: "We need to adjust the project scope." } });
  fireEvent.change(screen.getByLabelText("Proposed scope"), { target: { value: "The new scope requested for agreement." } });
  rerender(<ProjectChanges project={{ ...project, __v: 6 }} user={{ id: "client-1" }} onChanged={saved} />);
  fireEvent.click(screen.getByRole("button", { name: "Send change request" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(JSON.parse(api.mock.calls[0][1].body)).toMatchObject({ version: 5, terms: { scope: "The new scope requested for agreement.", milestones: [{ milestoneId: "step-1", dependsOn: [] }, { milestoneId: "step-2", dependsOn: [0] }] } });
});

test("requester can withdraw but cannot approve their own proposed changes", async () => {
  api.mockResolvedValue({ message: "Change withdrawn." });
  render(<ProjectChanges project={{ ...project, pendingAmendment: "change-1", amendments: [{ _id: "change-1", requestedBy: "client-1", requesterName: "Client", reason: "Please review the proposed scope.", terms, status: "Pending", createdAt: "2026-10-21T00:00:00Z" }] }} user={{ id: "client-1" }} onChanged={jest.fn()} />);
  expect(screen.queryByRole("button", { name: "Agree to proposed changes" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Project change response"), { target: { value: "I withdraw this proposal and will keep the old plan." } });
  fireEvent.click(screen.getByRole("button", { name: "Withdraw change request" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/projects/project-1/changes/change-1/respond", expect.objectContaining({ method: "POST" })));
});

test("other participant can decline and sees conflict errors without silently applying changes", async () => {
  api.mockRejectedValue(new Error("Project changed. Reload before trying again."));
  render(<ProjectChanges project={{ ...project, pendingAmendment: "change-1", amendments: [{ _id: "change-1", requestedBy: "client-1", requesterName: "Client", terms, status: "Pending", createdAt: "2026-10-21T00:00:00Z" }] }} user={{ id: "freelancer-1" }} onChanged={jest.fn()} />);
  expect(screen.queryByRole("button", { name: "Withdraw change request" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Project change response"), { target: { value: "We should keep the current agreement." } });
  fireEvent.click(screen.getByRole("button", { name: "Decline changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Project changed");
});
