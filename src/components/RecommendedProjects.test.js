import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { api } from "../api";
import RecommendedProjects from "./RecommendedProjects";
jest.mock("../api", () => ({ api: jest.fn() }));
beforeEach(() => api.mockReset());

test("a blank profile gets setup guidance rather than fake personalised projects", async () => {
  api.mockResolvedValue({ mode: "setup", projects: [], pages: 0, setup: { ready: false, completed: 0, total: 3 } });
  render(<MemoryRouter><RecommendedProjects /></MemoryRouter>);
  expect(await screen.findByText("Tell us what kind of work you do")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Set up my profile →" })).toHaveAttribute("href", "/profile");
  expect(screen.queryByRole("button", { name: "Read suggested brief →" })).not.toBeInTheDocument();
});

test("suggestions explain their relevance and open the real brief", async () => {
  const project = { _id: "project-1", title: "React dashboard", category: "Web Development", description: "Build a booking dashboard.", budget: 1000, deadline: "2035-12-31", reason: { matchedSkills: ["React"], preferredField: true } };
  api.mockResolvedValue({ mode: "profile", projects: [project], page: 1, pages: 1, setup: { ready: true } });
  const onOpen = jest.fn();
  render(<MemoryRouter><RecommendedProjects onOpen={onOpen} /></MemoryRouter>);
  expect(await screen.findByText("React dashboard")).toBeInTheDocument();
  expect(screen.getByText("Skills in common: React · Preferred field")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Read suggested brief →" }));
  expect(onOpen).toHaveBeenCalledWith(project);
});

test("a failed request can be retried without blocking ordinary browsing", async () => {
  api.mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue({ mode: "profile", projects: [], pages: 0 });
  render(<MemoryRouter><RecommendedProjects /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Retry suggestions" }));
  expect(await screen.findByText("No matching open projects right now")).toBeInTheDocument();
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
});
