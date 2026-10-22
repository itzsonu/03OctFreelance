import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HomePage from "./HomePage";
import { api } from "../api";

jest.mock("../api", () => ({ api: jest.fn() }));

test("restores shareable job filters and requests the selected result page", async () => {
  api.mockResolvedValue({ projects: [{ _id: "job-13", title: "React workspace", category: "Web Development", requiredSkills: ["React"], budget: 15000, deadline: "2030-12-31", createdAt: "2026-09-29T10:00:00Z" }], total: 13, page: 2, pageSize: 12, pages: 2 });
  render(<MemoryRouter initialEntries={["/?q=React&category=Web%20Development&minBudget=10000&page=2"]}><HomePage /></MemoryRouter>);
  expect(await screen.findByRole("link", { name: "View details for React workspace" })).toHaveAttribute("href", "/jobs/job-13");
  expect(api).toHaveBeenCalledWith("/projects/public?q=React&category=Web+Development&minBudget=10000&page=2");
  expect(screen.getByText("Showing 13–13 of 13 open projects")).toBeInTheDocument();
  expect(screen.getByLabelText("Category")).toHaveValue("Web Development");
  expect(screen.getByLabelText("Minimum budget")).toHaveValue(10000);
  expect(screen.getByText("Search: React")).toBeInTheDocument();
});