import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TalentDirectory from "./TalentDirectory";
import { api } from "../api";

jest.mock("../api", () => ({ api: jest.fn(), currentUser: () => ({ id: "client-1", name: "Client" }), signOut: jest.fn() }));
jest.mock("../components/NotificationCenter", () => () => null);

test("client can invite a visible freelancer to an open project", async () => {
  api.mockImplementation(path => {
    if (path === "/projects/mine") return Promise.resolve([{ _id: "project-1", title: "Build a portal", status: "Open" }]);
    if (path === "/invitations/sent") return Promise.resolve([]);
    if (path.startsWith("/talent?")) return Promise.resolve({ total: 1, talent: [{ id: "freelancer-1", name: "Riya", headline: "React developer", bio: "I build web apps.", skills: ["React"], experienceYears: 3, trust: { score: null }, reviews: { count: 0 } }] });
    if (path === "/invitations") return Promise.resolve({ id: "invite-1", status: "PENDING" });
    return Promise.reject(new Error(`Unexpected request ${path}`));
  });
  render(<MemoryRouter><TalentDirectory /></MemoryRouter>);
  expect(await screen.findByText("Riya")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /invite to project/i }));
  fireEvent.change(screen.getByPlaceholderText(/why this project fits/i), { target: { value: "Your React experience fits this portal project." } });
  fireEvent.click(screen.getByRole("button", { name: /send invitation/i }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/invitations", expect.objectContaining({ method: "POST", body: JSON.stringify({ projectId: "project-1", freelancerId: "freelancer-1", note: "Your React experience fits this portal project." }) })));
  expect(await screen.findByText(/invitation sent to Riya/i)).toBeInTheDocument();
});

test("talent filters and pagination are restored from the URL", async () => {
  api.mockReset();
  api.mockImplementation(path => {
    if (path === "/projects/mine") return Promise.resolve([]);
    if (path === "/invitations/sent") return Promise.resolve([]);
    if (path.startsWith("/talent?")) return Promise.resolve({ total: 13, page: 2, pageSize: 12, pages: 2, talent: [] });
    return Promise.reject(new Error(`Unexpected request ${path}`));
  });
  render(<MemoryRouter initialEntries={["/talent?skill=React&availability=available&minExperience=3&page=2"]}><TalentDirectory /></MemoryRouter>);
  expect(await screen.findByText("Showing 13–13 of 13 visible profiles")).toBeInTheDocument();
  expect(api).toHaveBeenCalledWith("/talent?skill=React&availability=available&minExperience=3&page=2");
  expect(screen.getByLabelText("Skill")).toHaveValue("React");
  expect(screen.getByLabelText("Availability")).toHaveValue("available");
});
