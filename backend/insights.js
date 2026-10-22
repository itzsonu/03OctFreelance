const DAY = 24 * 60 * 60 * 1000;

function ageInDays(value, now) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? (now.getTime() - timestamp) / DAY : null;
}

function projectInsights(project, now = new Date()) {
  const milestones = project.milestones || [];
  const total = milestones.length;
  const approved = milestones.filter(item => item.status === "completed").length;
  const awaitingReview = milestones.filter(item => item.status === "submitted");
  const revisionsPending = milestones.filter(item => item.status === "revision_requested");
  const deadlineDay = /^\d{4}-\d{2}-\d{2}$/.test(project.deadline || "")
    ? new Date(`${project.deadline}T00:00:00.000Z`).getTime()
    : NaN;
  const todayDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysRemaining = Number.isFinite(deadlineDay) ? Math.round((deadlineDay - todayDay) / DAY) : null;

  const base = {
    approved, total, percent: total ? Math.round(approved / total * 100) : 0,
    daysRemaining, awaitingReview: awaitingReview.length, revisionsPending: revisionsPending.length,
  };
  if (["Closed", "Cancelled"].includes(project.status)) return { ...base, level: project.status === "Cancelled" ? "cancelled" : "not_started", reasons: [project.status === "Cancelled" ? "Project cancelled; work history retained." : "Hiring is closed."] };
  if (project.status === "Completed" || (total > 0 && approved === total)) {
    return { ...base, level: "complete", reasons: ["All milestones approved."] };
  }
  if (project.status === "Open") {
    return { ...base, level: "not_started", reasons: ["Waiting for a freelancer to be assigned."] };
  }

  const reasons = [];
  let level = "on_track";
  if (daysRemaining !== null && daysRemaining < 0) {
    level = "urgent";
    reasons.push(`Deadline passed ${Math.abs(daysRemaining)} day${Math.abs(daysRemaining) === 1 ? "" : "s"} ago.`);
  } else if (daysRemaining !== null && daysRemaining <= 7) {
    level = "attention";
    reasons.push(daysRemaining === 0 ? "Deadline is today." : `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} until the deadline.`);
  }

  if (awaitingReview.length) {
    if (level === "on_track") level = "attention";
    reasons.push(`${awaitingReview.length} milestone${awaitingReview.length === 1 ? "" : "s"} waiting for client review.`);
    if (awaitingReview.some(item => item.submittedAt && ageInDays(item.submittedAt, now) > 2)) {
      reasons.push("A submission has waited over 2 days for review.");
    }
  }
  if (revisionsPending.length) {
    if (level === "on_track") level = "attention";
    reasons.push(`${revisionsPending.length} revision request${revisionsPending.length === 1 ? "" : "s"} waiting for updated work.`);
    if (revisionsPending.some(item => item.revisionRequestedAt && ageInDays(item.revisionRequestedAt, now) > 3)) {
      reasons.push("A revision request has been open over 3 days.");
    }
  }
  if (!reasons.length) reasons.push("No deadline or review action needs attention right now.");
  return { ...base, level, reasons };
}

module.exports = { projectInsights };
