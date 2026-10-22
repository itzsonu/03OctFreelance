const test = require("node:test");
const assert = require("node:assert/strict");
const { projectOutlook } = require("./outlook");

const now = new Date("2026-09-15T12:00:00Z");
const steps = [
  { status: "completed", approvedAt: "2026-09-10T10:00:00Z" },
  { status: "completed", approvedAt: "2026-09-14T10:00:00Z" },
  { status: "active", approvedAt: null },
  { status: "locked", approvedAt: null },
];
const base = { status: "In Progress", deadline: "2026-09-18", milestones: steps, activity: [{ type: "milestone_approved", createdAt: "2026-09-14T10:00:00Z" }] };

test("estimates completion from observed approvals and explains a likely late finish", () => {
  const result = projectOutlook(base, now);
  assert.equal(result.status, "forecast_late");
  assert.equal(result.method, "observed_milestone_pace");
  assert.equal(result.paceDays, 4);
  assert.equal(result.projectedDate, "2026-09-23");
  assert.equal(result.daysBeyondDeadline, 5);
  assert.equal(result.criticalChainRemaining, 2);
  assert.equal(result.remaining, 2);
  assert.match(result.nextAction, /scope or the deadline/);
});

test("parallel plans estimate from the longest unresolved dependency chain", () => {
  const project = {
    ...base,
    deadline: "2026-10-20",
    hasExplicitDependencies: true,
    milestones: [
      { _id: "approved-a", status: "completed", approvedAt: "2026-09-10T10:00:00Z", dependsOn: [] },
      { _id: "approved-b", status: "completed", approvedAt: "2026-09-14T10:00:00Z", dependsOn: ["approved-a"] },
      { _id: "branch-a", title: "Design", status: "active", dependsOn: ["approved-b"] },
      { _id: "branch-b", title: "Copy", status: "active", dependsOn: ["approved-b"] },
      { _id: "finish-a", title: "Implementation", status: "locked", dependsOn: ["branch-a"] },
      { _id: "finish-b", title: "Launch", status: "locked", dependsOn: ["branch-b"] },
    ],
  };
  const result = projectOutlook(project, now);

  assert.equal(result.remaining, 4);
  assert.equal(result.criticalChainRemaining, 2);
  assert.equal(result.projectedDate, "2026-09-23");
  assert.equal(result.scheduleBasis, "critical_dependency_chain");
});

test("identifies the unfinished prerequisite blocking locked work", () => {
  const result = projectOutlook({
    ...base,
    milestones: [
      { _id: "design", title: "Design", status: "active", dependsOn: [] },
      { _id: "build", title: "Implementation", status: "locked", dependsOn: ["design"] },
    ],
    hasExplicitDependencies: true,
  }, now);

  assert.equal(result.status, "needs_review");
  assert.equal(result.blockedMilestones, 1);
  assert.match(result.nextAction, /complete the prerequisite.*Design.*Implementation/i);
});

test("does not invent a forecast from a single or missing approval date", () => {
  const result = projectOutlook({ ...base, milestones: [{ status: "completed", approvedAt: null }, { status: "active" }] }, now);
  assert.equal(result.status, "insufficient_data");
  assert.equal(result.projectedDate, null);
  assert.equal(result.paceDays, null);
});

test("missing and future approval dates do not create a pace estimate", () => {
  const result = projectOutlook({
    ...base,
    milestones: [
      { status: "completed", approvedAt: null },
      { status: "completed", approvedAt: "2026-09-16T10:00:00Z" },
      { status: "active" },
    ],
  }, now);

  assert.equal(result.approved, 2);
  assert.equal(result.paceDays, null);
  assert.equal(result.projectedDate, null);
});

test("overdue unfinished milestone dates become explicit review evidence", () => {
  const result = projectOutlook({
    ...base,
    deadline: "2026-10-20",
    milestones: [{ _id: "draft", title: "First draft", status: "active", dueDate: "2026-09-12" }],
  }, now);

  assert.equal(result.status, "needs_review");
  assert.ok(result.signals.some(signal => signal.includes('"First draft" was due 3 days ago')));
  assert.match(result.nextAction, /overdue milestone.*First draft/i);
});

test("waiting for client review takes priority in the next action", () => {
  const result = projectOutlook({
    ...base,
    milestones: [
      { status: "submitted", title: "Design", submittedAt: "2026-09-14T10:00:00Z" },
      { status: "locked", title: "Implementation" },
    ],
  }, now);

  assert.match(result.nextAction, /client must review submitted work/i);
});

test("a revision request identifies the freelancer as the next actor", () => {
  const result = projectOutlook({
    ...base,
    milestones: [{ status: "revision_requested", title: "Design", revisionRequestedAt: "2026-09-14T10:00:00Z" }],
  }, now);

  assert.match(result.nextAction, /freelancer should address.*changes.*submit a revision/i);
});

test("separates current revision and inactivity evidence from pace", () => {
  const revised = projectOutlook({ ...base, deadline: "2026-10-20", milestones: [{ ...steps[0] }, { ...steps[1] }, { ...steps[2], revisionCount: 2 }, steps[3]] }, now);
  assert.equal(revised.status, "needs_review");
  assert.ok(revised.signals.some(signal => signal.includes("multiple revisions")));
  assert.match(revised.nextAction, /acceptance criteria/);
  const idle = projectOutlook({ ...base, deadline: "2026-10-20", milestones: [{ status: "active" }], activity: [{ type: "freelancer_assigned", createdAt: "2026-09-01T00:00:00Z" }] }, now);
  assert.equal(idle.status, "needs_review");
  assert.match(idle.signals[0], /14 days/);
});

test("handles on-pace, overdue, open and completed projects without false forecasts", () => {
  assert.equal(projectOutlook({ ...base, deadline: "2026-10-20" }, now).status, "on_pace");
  assert.equal(projectOutlook({ ...base, deadline: "2026-09-14" }, now).status, "overdue");
  assert.equal(projectOutlook({ ...base, status: "Open" }, now).status, "not_started");
  assert.equal(projectOutlook({ ...base, status: "Completed" }, now).status, "complete");
});
