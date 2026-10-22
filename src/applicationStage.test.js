import { applicationStage } from "./applicationStage";

const project = { status: "Open", listingRevision: 2 };
const pending = { status: "PENDING" };
const label = (application, job = project, role = "freelancer") => applicationStage(application, job, role, "freelancer-1").label;

test("sending a proposal does not claim that work has started", () => {
  expect(label(pending)).toBe("Proposal sent");
  expect(label(pending, project, "client")).toBe("Needs review");
  expect(label(pending, null)).toBe("Proposal sent");
});

test("current offer shows who must act and stale offers do not look actionable", () => {
  const offer = { _id: "offer-1", status: "OPEN", listingRevision: 2, createdBy: "client-1", version: 1 };
  const application = { ...pending, currentOfferId: "offer-1", currentOfferState: "OPEN", offers: [offer] };
  expect(label(application)).toBe("Offer to review");
  expect(label({ ...application, offers: [{ ...offer, createdBy: "freelancer-1" }] })).toBe("Waiting for client");
  expect(label(application, { ...project, listingRevision: 3 })).toBe("Proposal sent");
});

test("agreed work reflects the actual project stage", () => {
  const hired = { status: "ACCEPTED" };
  expect(label(hired, { status: "In Progress" })).toBe("In progress");
  expect(label(hired, { status: "Completed" })).toBe("Completed");
  expect(label(hired, { status: "Cancelled" })).toBe("Project cancelled");
  expect(label(pending, { status: "In Progress", freelancer: "someone-else" })).toBe("Hiring closed");
});
