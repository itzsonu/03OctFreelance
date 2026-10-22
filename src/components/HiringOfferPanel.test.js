import { fireEvent, render as renderView, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HiringOfferPanel from "./HiringOfferPanel";
import { api } from "../api";

jest.mock("../api", () => ({ api: jest.fn(), currentUser: () => ({ id: "freelancer-1" }) }));
const render = ui => renderView(<MemoryRouter>{ui}</MemoryRouter>);

const project = { status: "Open", _id: "project-1", title: "Dashboard", budget: 12000, deadline: "2030-11-20" };
const offer = { _id: "offer-1", version: 1, createdBy: "client-1", createdAt: "2030-10-01T12:00:00.000Z", status: "OPEN", terms: { scope: "Build and review the agreed responsive dashboard.", amount: 12000, deliveryDate: "2030-11-20", milestones: [{ title: "Delivery", description: "Implement dashboard.", payment: 12000, dueDate: "2030-11-20" }] }, acceptances: [{ actor: "client-1", acceptedAt: "2030-10-01T12:00:00.000Z" }] };
const application = { _id: "application-1", status: "PENDING", currentOfferId: "offer-1", currentOfferState: "OPEN", offers: [offer] };

beforeEach(() => api.mockReset());

test("freelancer can accept the exact current offer and assignment callback runs", async () => {
  api.mockResolvedValue({ application: { ...application, status: "ACCEPTED" }, project: { _id: "project-1", status: "In Progress" } });
  const onAssigned = jest.fn();
  render(<HiringOfferPanel application={application} project={project} role="freelancer" onAssigned={onAssigned} />);
  fireEvent.click(screen.getByRole("button", { name: "Accept version 1" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/applications/application-1/offer/offer-1/accept", { method: "POST", body: "{}" }));
  expect(await screen.findByText("Both participants agreed to these terms. The freelancer is assigned.")).toBeInTheDocument();
  expect(onAssigned).toHaveBeenCalledTimes(1);
});

test("freelancer can counter by creating a new version that replaces the current offer", async () => {
  const countered = { ...application, currentOfferId: "offer-2", offers: [offer, { ...offer, _id: "offer-2", version: 2, createdBy: "freelancer-1", status: "OPEN", terms: { ...offer.terms, amount: 11000, milestones: [{ ...offer.terms.milestones[0], payment: 11000 }] }, acceptances: [{ actor: "freelancer-1", acceptedAt: "2030-10-02T12:00:00.000Z" }] }] };
  api.mockResolvedValue({ application: countered });
  render(<HiringOfferPanel application={application} project={project} role="freelancer" />);
  fireEvent.click(screen.getByRole("button", { name: "Counter with terms" }));
  fireEvent.change(screen.getByLabelText("Final scope"), { target: { value: "Build, test, and review the responsive dashboard delivery." } });
  fireEvent.change(screen.getByLabelText("Proposed amount"), { target: { value: "11000" } });
  fireEvent.change(screen.getByLabelText("Delivery date"), { target: { value: "2030-11-21" } });
  fireEvent.change(screen.getByLabelText("Planned amount"), { target: { value: "11000" } });
  fireEvent.click(screen.getByRole("button", { name: "Send new version" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/applications/application-1/offer", expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ replacesOfferId: "offer-1", terms: { scope: "Build, test, and review the responsive dashboard delivery.", amount: 11000, deliveryDate: "2030-11-21", milestones: [{ title: "Delivery", description: "Implement dashboard.", payment: 11000, dueDate: "2030-11-20", dependsOn: [] }] } }),
  })));
  expect(await screen.findByText("Offer version 2 sent.")).toBeInTheDocument();
});

test("initial offer keeps project milestones, decimal amounts and parallel dependencies", async () => {
  const graph = { ...project, budget: 100.29, description: "Build and review a complete client dashboard.", hasExplicitDependencies: true, milestones: [
    { _id: "a", title: "Scope", description: "Agree requirements", payment: 19.99, dependsOn: [] },
    { _id: "b", title: "Frontend", payment: 20.1, dependsOn: ["a"] },
    { _id: "c", title: "Backend", payment: 30.1, dependsOn: ["a"] },
    { _id: "d", title: "Integration", payment: 30.1, dependsOn: ["b", "c"] },
  ] };
  const pending = { _id: "application-1", status: "PENDING", offers: [] };
  api.mockResolvedValue({ application: { ...pending, offers: [{ ...offer, version: 1 }] } });
  render(<HiringOfferPanel application={pending} project={graph} role="client" />);
  fireEvent.click(screen.getByRole("button", { name: "Propose terms" }));
  expect(screen.getAllByLabelText("Title").map(input => input.value)).toEqual(["Scope", "Frontend", "Backend", "Integration"]);
  expect(screen.getAllByLabelText("Planned amount")[0]).toBeValid();
  fireEvent.click(screen.getByRole("button", { name: "Send offer" }));
  await waitFor(() => expect(api).toHaveBeenCalled());
  const body = JSON.parse(api.mock.calls[0][1].body);
  expect(body.terms.amount).toBe(100.29);
  expect(body.terms.milestones.map(item => item.dependsOn)).toEqual([[], [0], [0], [1, 2]]);
  expect(body.terms.milestones[0].payment).toBe(19.99);
});

test("counteroffer retains the offer graph and allows dependency changes", async () => {
  const milestones = [
    { title: "Scope", description: "Confirm requirements", payment: 4000, dependsOn: [] },
    { title: "Frontend", description: "Build screens", payment: 4000, dependsOn: [0] },
    { title: "Backend", description: "Build API", payment: 4000, dependsOn: [0] },
  ];
  const graphOffer = { ...offer, terms: { ...offer.terms, milestones } };
  api.mockResolvedValue({ application: { ...application, offers: [graphOffer] } });
  render(<HiringOfferPanel application={{ ...application, offers: [graphOffer] }} project={project} role="freelancer" />);
  fireEvent.click(screen.getByRole("button", { name: "Counter with terms" }));
  fireEvent.click(screen.getAllByLabelText("Step 1 · Scope")[1]);
  fireEvent.click(screen.getByRole("button", { name: "Send new version" }));
  await waitFor(() => expect(api).toHaveBeenCalled());
  expect(JSON.parse(api.mock.calls[0][1].body).terms.milestones.map(item => item.dependsOn)).toEqual([[], [0], []]);
});

test("offer cannot silently delete a milestone used by later steps", () => {
  const graphOffer = { ...offer, terms: { ...offer.terms, milestones: [
    { title: "Scope", description: "Agree scope", payment: 6000, dependsOn: [] },
    { title: "Build", description: "Deliver work", payment: 6000, dependsOn: [0] },
  ] } };
  render(<HiringOfferPanel application={{ ...application, offers: [graphOffer] }} project={project} role="freelancer" />);
  fireEvent.click(screen.getByRole("button", { name: "Counter with terms" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Remove milestone" })[0]);
  expect(screen.getByRole("alert")).toHaveTextContent(/Steps 2 depend on it/);
  expect(screen.getAllByLabelText("Title")).toHaveLength(2);
  fireEvent.click(screen.getByLabelText("Step 1 · Scope"));
  fireEvent.click(screen.getAllByRole("button", { name: "Remove milestone" })[0]);
  expect(screen.getAllByLabelText("Title")).toHaveLength(1);
});
