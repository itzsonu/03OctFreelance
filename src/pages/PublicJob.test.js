import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PublicJob from "./PublicJob";
import { api } from "../api";

jest.mock("../api", () => ({ api: jest.fn(), currentUser: () => null }));

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
