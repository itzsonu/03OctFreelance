export function applicationStage(application, project = {}, role, userId) {
  project = project || {};
  if (application.status === "WITHDRAWN") return { label: "Withdrawn", tone: "rejected", detail: "This proposal has been withdrawn." };
  if (application.status === "REJECTED") return { label: "Declined", tone: "rejected", detail: "This proposal was not selected." };
  if (application.status === "ACCEPTED") {
    if (project.status === "Completed") return { label: "Completed", tone: "completed", detail: "The agreed project is complete." };
    if (project.status === "Cancelled") return { label: "Project cancelled", tone: "cancelled", detail: "The hired project was cancelled." };
    return { label: project.status === "In Progress" ? "In progress" : "Hired", tone: "accepted", detail: "Both sides agreed to the terms. Use the workroom for delivery." };
  }
  if (project.status && (project.status !== "Open" || project.freelancer)) return { label: "Hiring closed", tone: "rejected", detail: "This project is no longer accepting proposals." };
  const offer = application.offers?.find(item => String(item._id) === String(application.currentOfferId));
  if (offer?.status === "OPEN" && application.currentOfferState === "OPEN" && (offer.listingRevision || 0) === (project.listingRevision || 0)) {
    const sentByYou = userId && String(offer.createdBy?._id || offer.createdBy) === String(userId);
    return { label: sentByYou ? role === "client" ? "Waiting for freelancer" : "Waiting for client" : "Offer to review", tone: "pending", detail: sentByYou ? `Offer version ${offer.version} is awaiting the other participant’s approval.` : `Review offer version ${offer.version}. Work begins after both sides agree.` };
  }
  return role === "client"
    ? { label: "Needs review", tone: "pending", detail: "Review the proposal and propose terms to hire this freelancer." }
    : { label: "Proposal sent", tone: "pending", detail: "Waiting for client review. Work starts after both sides agree to the terms." };
}
