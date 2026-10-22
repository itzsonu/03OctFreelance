import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FreelancerProfile from "./FreelancerProfile";
import { api } from "../api";

jest.mock("../api", () => ({ api: jest.fn(), currentUser: jest.fn(), signOut: jest.fn() }));
jest.mock("../components/NotificationCenter", () => () => null);

test("shows the freelancer their verified trust evidence", async () => {
  api.mockResolvedValue({ profile: { skills: ["Figma"], experienceYears: 2 }, trust: { score: 73, approvedMilestones: 2, completedProjects: 1, revisionRequests: 0, scoredMilestones: 2, clientCount: 1 } });
  render(<MemoryRouter><FreelancerProfile /></MemoryRouter>);
  expect(await screen.findByText("73/100")).toBeInTheDocument();
  expect(screen.getByText(/^2 approved milestones ·/)).toBeInTheDocument();
  expect(screen.getByText(/distinct stored client IDs have approved work/)).toHaveTextContent("2 of 2 raw approved milestones count");
  expect(screen.getByText(/distinct stored client IDs have approved work/)).toHaveTextContent("Stored IDs are account references, not identity verification.");
});

test("freelancer can save portfolio links, availability and an optional rate", async () => {
  api.mockReset();
  api.mockResolvedValue({ profile: { headline: "Designer", bio: "I make useful interfaces.", skills: ["Figma"], experienceYears: 2, portfolioItems: [{ title: "Dashboard", description: "A compact analytics workspace.", url: "https://example.test/dashboard" }], availability: "limited", hourlyRate: 90 }, trust: null });
  render(<MemoryRouter><FreelancerProfile /></MemoryRouter>);
  await screen.findByRole("button", { name: /add item/i });
  fireEvent.change(screen.getByLabelText("Availability"), { target: { value: "limited" } });
  fireEvent.change(screen.getByLabelText("Hourly rate (₹)"), { target: { value: "90" } });
  fireEvent.click(screen.getByRole("button", { name: /save portfolio details/i }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/profile/me", expect.objectContaining({ method: "PUT" })));
  const saved = JSON.parse(api.mock.calls.find(call => call[1]?.method === "PUT")[1].body);
  expect(saved.portfolioItems).toEqual([{ title: "Dashboard", description: "A compact analytics workspace.", url: "https://example.test/dashboard" }]);
  expect(saved.availability).toBe("limited");
  expect(saved.hourlyRate).toBe(90);
});
