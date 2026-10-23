import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

test("a newcomer can choose work fields and save with zero experience and no sample", async () => {
  api.mockReset();
  const setup = { ready: false, completed: 0, total: 3, steps: [{ key: "skills", label: "Add your skills", done: false }] };
  api.mockResolvedValueOnce({ profile: {}, trust: { score: null }, setup }).mockImplementation((path, options) => Promise.resolve({ profile: JSON.parse(options.body), setup: { ...setup, ready: true, completed: 3 } }));
  render(<MemoryRouter><FreelancerProfile /></MemoryRouter>);
  await screen.findByRole("region", { name: "Profile setup guide" });
  expect(screen.getByText("No score yet")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Professional headline"), { target: { value: "React developer" } });
  fireEvent.change(screen.getByLabelText("About you"), { target: { value: "I build responsive dashboards and interfaces." } });
  fireEvent.change(screen.getByLabelText(/Skills Separate each skill/), { target: { value: "React" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Web Development", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Save profile ↗", exact: true }));
  await screen.findByText("Your profile is ready to explore work");
  const body = JSON.parse(api.mock.calls.find(call => call[1]?.method === "PUT")[1].body);
  expect(body.preferredCategories).toEqual(["Web Development"]);
  expect(body.experienceYears).toBe(0); expect(body.portfolioItems).toEqual([]); expect(body.discoverable).toBe(false);
});

test("a failed profile load cannot save an empty replacement", async () => {
  api.mockReset();
  api.mockRejectedValueOnce(new Error("Connection interrupted")).mockResolvedValue({ profile: { headline: "Saved headline" } });
  render(<MemoryRouter><FreelancerProfile /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Retry profile" }));
  expect(screen.queryByRole("button", { name: "Save profile ↗" })).not.toBeInTheDocument();
  expect(await screen.findByLabelText("Professional headline")).toHaveValue("Saved headline");
  expect(api.mock.calls.every(call => !call[1]?.method)).toBe(true);
});

test("availability navigation waits for the saved profile and focuses its control", async () => {
  api.mockReset();
  let resolve;
  api.mockReturnValue(new Promise(done => { resolve = done; }));
  render(<MemoryRouter initialEntries={["/profile#profile-availability"]}><FreelancerProfile /></MemoryRouter>);
  await act(async () => resolve({ profile: { availability: "unavailable" } }));
  expect(screen.getByLabelText("Availability")).toHaveFocus();
  expect(screen.getByLabelText("Availability")).toHaveValue("unavailable");
});

test("a pending save locks edits and a failed save keeps the draft for retry", async () => {
  api.mockReset();
  let reject;
  api.mockResolvedValueOnce({ profile: { headline: "Saved headline" } }).mockReturnValueOnce(new Promise((resolve, fail) => { reject = fail; }));
  render(<MemoryRouter><FreelancerProfile /></MemoryRouter>);
  const headline = await screen.findByLabelText("Professional headline");
  fireEvent.change(headline, { target: { value: "My draft headline" } });
  const save = screen.getByRole("button", { name: "Save profile ↗" });
  fireEvent.click(save); fireEvent.submit(save.closest("form"));
  expect(headline).toBeDisabled();
  expect(screen.getByLabelText("Availability")).toBeDisabled();
  expect(api.mock.calls.filter(call => call[1]?.method === "PUT")).toHaveLength(1);
  await act(async () => reject(new Error("Connection interrupted; try again.")));
  expect(headline).toBeEnabled(); expect(headline).toHaveValue("My draft headline");
  expect(screen.getByRole("alert").parentElement).toHaveFocus();
  expect(screen.getByRole("button", { name: "Save profile ↗" })).toBeEnabled();
});
