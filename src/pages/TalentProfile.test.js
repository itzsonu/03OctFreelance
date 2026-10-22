import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TalentProfile from "./TalentProfile";
import { api } from "../api";

jest.mock("../api", () => ({ api: jest.fn(), currentUser: () => ({ id: "client-1", name: "Client" }), signOut: jest.fn() }));
jest.mock("../components/NotificationCenter", () => () => null);

test("client can review a freelancer profile and invite them", async () => {
  api.mockImplementation((path, options) => {
    if (path === "/talent/freelancer-1") return Promise.resolve({ id: "freelancer-1", name: "Asha", headline: "React developer", bio: "I build responsive apps.", skills: ["React"], experienceYears: 3, portfolioUrl: "", portfolioItems: [{ title: "Member portal", description: "A responsive member workspace.", url: "https://example.test/portal" }], availability: "limited", hourlyRate: 110, trust: { score: 80, approvedMilestones: 4, completedProjects: 2 }, reviews: { average: 5, count: 1, items: [{ rating: 5, text: "Great collaboration and delivery.", createdAt: "2026-09-29T10:00:00Z" }] } });
    if (path === "/projects/mine") return Promise.resolve([{ _id: "project-1", title: "Website redesign", status: "Open" }]);
    if (path === "/invitations/sent") return Promise.resolve([]);
    if (path === "/invitations" && options?.method === "POST") return Promise.resolve({ id: "invite-1", status: "PENDING" });
    return Promise.reject(new Error("Unexpected request"));
  });
  render(<MemoryRouter initialEntries={["/talent/freelancer-1"]}><Routes><Route path="/talent/:freelancerId" element={<TalentProfile />} /></Routes></MemoryRouter>);
  await screen.findByText("Great collaboration and delivery.");
  expect(screen.getByText("Limited availability")).toBeInTheDocument();
  expect(screen.getByText("₹110/hr")).toBeInTheDocument();
  expect(screen.getByText("A responsive member workspace.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open external work ↗" })).toHaveAttribute("href", "https://example.test/portal");
  fireEvent.change(screen.getByLabelText("Personal invitation"), { target: { value: "Your React work fits my website redesign project." } });
  fireEvent.click(screen.getByRole("button", { name: "Send invitation →" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/invitations", expect.objectContaining({ method: "POST" })));
  await screen.findByText("Invitation sent to Asha.");
});
