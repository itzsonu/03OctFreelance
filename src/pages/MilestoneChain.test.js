import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import MilestoneChain from "./MilestoneChain";
import { api, currentUser } from "../api";

jest.mock("../api", () => ({ api: jest.fn(), currentUser: jest.fn(), subscribeUpdates: jest.fn(() => () => {}) }));
jest.mock("../components/NotificationCenter", () => () => null);

const project = {
  title: "Brand identity", status: "In Progress", budget: 10000, deadline: "2026-12-01", hasExplicitDependencies: true,
  milestones: [{ _id: "step1", title: "Concepts", status: "submitted", payment: 3000, submittedWork: "First draft", dependsOn: [], submissions: [{ work: "First draft", submittedAt: "2026-09-27T10:00:00Z" }] }],
  activity: [],
  outlook: { status: "insufficient_data", headline: "More approved milestones needed", approved: 0, total: 1, projectedDate: null, signals: [], nextAction: "Review submitted work to keep the plan moving." },
};

test("client can request a revision and sees saved feedback", async () => {
  currentUser.mockReturnValue({ role: "client" });
  api.mockReset();
  let projectLoads = 0;
  const revisedProject = { ...project, milestones: [{ ...project.milestones[0], status: "revision_requested", revisionFeedback: "Please adjust the logo spacing." }] };
  api.mockImplementation((path, options) => {
    if (path === "/workrooms/projects/project1/disputes") return Promise.resolve([]);
    if (options?.method === "POST") return Promise.resolve({});
    if (path === "/projects/project1") return Promise.resolve(++projectLoads === 1 ? project : revisedProject);
    return Promise.resolve({});
  });
  render(<MemoryRouter initialEntries={["/milestones/project1"]}><Routes><Route path="/milestones/:projectId" element={<MilestoneChain />} /></Routes></MemoryRouter>);
  await screen.findByLabelText("Revision feedback");
  expect(screen.getByText("More approved milestones needed")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Revision feedback"), { target: { value: "Please adjust the logo spacing." } });
  fireEvent.click(screen.getByRole("button", { name: "Send revision request" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/projects/project1/milestone/step1/request-revision", expect.objectContaining({ method: "POST", body: JSON.stringify({ feedback: "Please adjust the logo spacing." }) })));
  await waitFor(() => expect(screen.getByText("Please adjust the logo spacing.", { selector: ".feedback-box p" })).toBeInTheDocument());
});
