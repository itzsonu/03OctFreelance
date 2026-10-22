import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PublicJob from "./PublicJob";
import { api, restoreSession } from "../api";

jest.mock("../api", () => ({ api: jest.fn(), currentUser: () => null, restoreSession: jest.fn() }));
beforeEach(() => { restoreSession.mockReset(); restoreSession.mockResolvedValue(null); });

test("visitors can inspect the full project before signing in", async () => {
  api.mockResolvedValue({ id: "project-1", title: "Build a dashboard", category: "Web Development", description: "Create a responsive React dashboard.", requiredSkills: ["React"], budget: 12000, deadline: "2030-12-31", createdAt: "2026-09-29T10:00:00Z", company: { name: "Northstar Studio", overview: "A small product team." }, milestones: [{ id: "one", title: "Design", description: "Wireframes and design", payment: 4000 }] });
  render(<MemoryRouter initialEntries={["/jobs/project-1"]}><Routes><Route path="/jobs/:projectId" element={<PublicJob />} /></Routes></MemoryRouter>);
  await screen.findByRole("heading", { name: "Build a dashboard" });
  expect(screen.getByText("Wireframes and design")).toBeInTheDocument();
  expect(screen.getByText("Web Development · OPEN FOR PROPOSALS")).toBeInTheDocument();
  expect(screen.getByText("Northstar Studio")).toBeInTheDocument();
  expect(screen.getByText("A small product team.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sign in to apply →" })).toHaveAttribute("href", "/login?role=freelancer&project=project-1");
});

test("Other project field is visible to visiting freelancers", async () => {
  api.mockResolvedValue({ id: "other-project", title: "Research a building plan", category: "Other", customCategory: "Architecture", description: "Review a building plan and deliver recommendations.", requiredSkills: ["Architecture"], budget: 1000, deadline: "2030-12-31", createdAt: "2026-09-29T10:00:00Z", milestones: [] });
  render(<MemoryRouter initialEntries={["/jobs/other-project"]}><Routes><Route path="/jobs/:projectId" element={<PublicJob />} /></Routes></MemoryRouter>);
  expect(await screen.findByText("Other · Architecture · OPEN FOR PROPOSALS")).toBeInTheDocument();
});

const brief = { id: "project-1", title: "Session continuity project", description: "Review this brief without losing your session.", requiredSkills: [], milestones: [], createdAt: "2026-10-01T10:00:00Z" };
const openBrief = () => render(<MemoryRouter initialEntries={["/jobs/project-1?from=applications"]}><Routes><Route path="/jobs/:projectId" element={<PublicJob />} /></Routes></MemoryRouter>);

test("a fresh brief page restores the cookie session and returns to applications", async () => {
  let finishSession;
  restoreSession.mockReturnValue(new Promise(resolve => { finishSession = resolve; }));
  api.mockResolvedValue(brief);
  openBrief();
  await screen.findByRole("heading", { name: brief.title });
  expect(screen.getByText("Checking your sign-in…")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /sign in to apply/i })).not.toBeInTheDocument();
  await act(async () => finishSession({ id: "freelancer-1", role: "freelancer" }));
  expect(screen.getByRole("link", { name: "Back to my application →" })).toHaveAttribute("href", "/freelancer-dashboard?view=applications");
  expect(screen.queryByRole("link", { name: /sign in to apply/i })).not.toBeInTheDocument();
});

test("a failed session check can be retried while the public brief stays readable", async () => {
  restoreSession.mockRejectedValueOnce(new Error("Connection unavailable")).mockResolvedValue({ id: "freelancer-1", role: "freelancer" });
  api.mockResolvedValue(brief);
  openBrief();
  await screen.findByRole("alert");
  expect(screen.getByRole("heading", { name: brief.title })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /sign in to apply/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry sign-in check" }));
  expect(await screen.findByRole("link", { name: "Back to my application →" })).toBeInTheDocument();
});
