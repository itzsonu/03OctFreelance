const DAY = 24 * 60 * 60 * 1000;

function validTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function dateOnly(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function milestoneId(milestone) {
  return milestone?._id?.toString?.() || "";
}

function scheduleEvidence(project, milestones) {
  const remaining = milestones.filter(step => step.status !== "completed");
  const sequential = {
    remaining: remaining.length,
    criticalChainRemaining: remaining.length,
    criticalChain: remaining.map((step, index) => step.title || `Milestone ${index + 1}`),
    scheduleBasis: "sequential_remaining",
    blockedMilestones: 0,
    blockedBy: null,
    dependenciesReliable: true,
  };
  if (!project.hasExplicitDependencies) return sequential;

  const byId = new Map();
  let dependenciesReliable = true;
  for (const step of milestones) {
    const id = milestoneId(step);
    if (!id) continue;
    if (byId.has(id)) dependenciesReliable = false;
    byId.set(id, step);
  }

  const chainById = new Map();
  let criticalChain = [];
  let blockedMilestones = 0;
  let blockedBy = null;
  for (const [index, step] of milestones.entries()) {
    if (step.status === "completed") continue;
    const dependencies = (step.dependsOn || []).map(dependency => dependency?.toString?.() || "");
    const unresolved = [];
    for (const dependencyId of dependencies) {
      const prerequisite = byId.get(dependencyId);
      if (!prerequisite) {
        dependenciesReliable = false;
        continue;
      }
      if (prerequisite.status !== "completed") unresolved.push(prerequisite);
    }

    if (step.status === "locked" && unresolved.length) {
      blockedMilestones += 1;
      if (!blockedBy) {
        const prerequisite = unresolved.find(item => item.status !== "locked") || unresolved[0];
        blockedBy = {
          prerequisite: prerequisite.title || "an earlier milestone",
          milestone: step.title || `Milestone ${index + 1}`,
        };
      }
    }

    let longestPrefix = [];
    for (const prerequisite of unresolved) {
      const prefix = chainById.get(milestoneId(prerequisite));
      if (!prefix) {
        dependenciesReliable = false;
        continue;
      }
      if (prefix.length > longestPrefix.length) longestPrefix = prefix;
    }
    const path = [...longestPrefix, step.title || `Milestone ${index + 1}`];
    const id = milestoneId(step);
    if (id) chainById.set(id, path);
    if (path.length > criticalChain.length) criticalChain = path;
  }

  if (!dependenciesReliable) {
    return {
      remaining: remaining.length,
      criticalChainRemaining: null,
      criticalChain: [],
      scheduleBasis: "dependencies_unresolved",
      blockedMilestones,
      blockedBy,
      dependenciesReliable: false,
    };
  }

  const criticalChainRemaining = remaining.length ? criticalChain.length : 0;
  return {
    remaining: remaining.length,
    criticalChainRemaining,
    criticalChain,
    scheduleBasis: "critical_dependency_chain",
    blockedMilestones,
    blockedBy,
    dependenciesReliable: true,
  };
}

function projectOutlook(project, now = new Date()) {
  const milestones = project.milestones || [];
  const total = milestones.length;
  const approved = milestones.filter(step => step.status === "completed").length;
  const schedule = scheduleEvidence(project, milestones);
  const remaining = schedule.remaining;
  const base = {
    method: "observed_milestone_pace",
    approved,
    total,
    ...schedule,
    paceDays: null,
    projectedDate: null,
    daysBeyondDeadline: null,
    signals: [],
    nextAction: null,
  };

  if (["Closed", "Cancelled"].includes(project.status)) return { ...base, status: project.status === "Cancelled" ? "cancelled" : "not_started", headline: project.status === "Cancelled" ? "Project cancelled; forecast stopped" : "Hiring is closed" };
  if (project.status === "Completed" || (total > 0 && remaining === 0)) {
    return { ...base, status: "complete", headline: "All milestones approved" };
  }
  if (project.status === "Open") {
    return { ...base, status: "not_started", headline: "Forecast starts after work is underway" };
  }

  const nowTime = validTime(now);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const todayDate = dateOnly(today);
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(project.deadline || "") ? Date.parse(`${project.deadline}T00:00:00.000Z`) : NaN;
  const signals = [];
  const repeated = milestones.filter(step => step.status !== "completed" && Number(step.revisionCount || 0) >= 2);
  if (repeated.length) signals.push(`${repeated.length} unfinished milestone${repeated.length === 1 ? " has" : "s have"} needed multiple revisions.`);
  if (!schedule.dependenciesReliable) signals.push("Milestone prerequisite links are incomplete, so a reliable finish date cannot be estimated.");
  if (schedule.blockedMilestones) signals.push(`${schedule.blockedMilestones} milestone${schedule.blockedMilestones === 1 ? " is" : "s are"} blocked by unfinished prerequisites.`);

  const overdueMilestones = milestones.filter(step => {
    if (step.status === "completed" || !/^\d{4}-\d{2}-\d{2}$/.test(step.dueDate || "")) return false;
    const dueTime = Date.parse(`${step.dueDate}T00:00:00.000Z`);
    return Number.isFinite(dueTime) && step.dueDate < todayDate;
  }).map(step => ({
    title: step.title || "Milestone",
    days: Math.round((today - Date.parse(`${step.dueDate}T00:00:00.000Z`)) / DAY),
  }));
  for (const overdue of overdueMilestones) {
    signals.push(`Milestone "${overdue.title}" was due ${overdue.days} day${overdue.days === 1 ? "" : "s"} ago.`);
  }

  const activityTimes = [
    ...(project.activity || []).map(item => validTime(item.createdAt)),
    ...milestones.flatMap(step => [validTime(step.submittedAt), validTime(step.approvedAt), validTime(step.revisionRequestedAt)]),
  ].filter(time => time !== null && time <= nowTime);
  const latestActivity = activityTimes.length ? Math.max(...activityTimes) : null;
  if (latestActivity !== null && (nowTime - latestActivity) >= 7 * DAY && !milestones.some(step => ["submitted", "revision_requested"].includes(step.status))) {
    signals.push(`No recorded project activity for ${Math.floor((nowTime - latestActivity) / DAY)} days.`);
  }

  const approvalTimes = milestones.filter(step => step.status === "completed").map(step => validTime(step.approvedAt)).filter(time => time !== null && time <= nowTime).sort((a, b) => a - b);
  let paceDays = null;
  let projectedDate = null;
  let daysBeyondDeadline = null;
  if (approvalTimes.length >= 2 && approvalTimes.at(-1) - approvalTimes[0] >= DAY) {
    paceDays = Math.max(1, Math.ceil((approvalTimes.at(-1) - approvalTimes[0]) / (approvalTimes.length - 1) / DAY));
    if (schedule.criticalChainRemaining !== null) {
      const projectedTime = today + paceDays * schedule.criticalChainRemaining * DAY;
      projectedDate = dateOnly(projectedTime);
      if (Number.isFinite(deadline)) daysBeyondDeadline = Math.max(0, Math.round((projectedTime - deadline) / DAY));
    }
  }

  const waitingForClient = milestones.some(step => step.status === "submitted");
  const waitingForFreelancer = milestones.some(step => step.status === "revision_requested");
  const nextAction = waitingForClient ? "The client must review submitted work to keep the plan moving."
    : waitingForFreelancer ? "The freelancer should address the requested changes and submit a revision."
      : !schedule.dependenciesReliable ? "Confirm the milestone prerequisite links with the project participants before relying on a finish date."
        : schedule.blockedBy ? `Complete the prerequisite "${schedule.blockedBy.prerequisite}" to unblock "${schedule.blockedBy.milestone}".`
          : overdueMilestones.length ? `Review the overdue milestone "${overdueMilestones[0].title}" with the freelancer and agree on a completion plan.`
      : signals.some(signal => signal.startsWith("No recorded")) ? "Check in and record the next milestone update."
        : repeated.length ? "Review repeated feedback and agree on clear acceptance criteria."
        : daysBeyondDeadline > 0 ? "Revisit scope or the deadline with the freelancer."
          : "Keep milestone updates and approvals current.";

  if (Number.isFinite(deadline) && deadline < today) {
    return { ...base, status: "overdue", headline: "Deadline has passed", paceDays, projectedDate, daysBeyondDeadline, signals, nextAction };
  }
  if (daysBeyondDeadline > 0) {
    return { ...base, status: "forecast_late", headline: "Current pace points past the deadline", paceDays, projectedDate, daysBeyondDeadline, signals, nextAction };
  }
  if (signals.length) {
    return { ...base, status: "needs_review", headline: "A delivery signal needs review", paceDays, projectedDate, daysBeyondDeadline, signals, nextAction };
  }
  if (paceDays === null || !schedule.dependenciesReliable) {
    return { ...base, status: "insufficient_data", headline: "More approved milestones needed", signals, nextAction };
  }
  return { ...base, status: "on_pace", headline: "Current pace fits the deadline", paceDays, projectedDate, daysBeyondDeadline, signals, nextAction };
}

module.exports = { projectOutlook };
