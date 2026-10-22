const test = require("node:test");
const assert = require("node:assert/strict");
const { projectInsights } = require("./insights");

const now = new Date("2026-09-27T12:00:00Z");
const base = { status: "In Progress", deadline: "2026-10-20", milestones: [{ status: "active" }, { status: "locked" }] };

test("healthy work is on track and shows accurate progress", () => {
  assert.deepEqual(projectInsights(base, now), {
    approved: 0, total: 2, percent: 0, daysRemaining: 23,
    awaitingReview: 0, revisionsPending: 0, level: "on_track",
    reasons: ["No deadline or review action needs attention right now."],
  });
});

test("overdue incomplete work is urgent", () => {
  const result = projectInsights({ ...base, deadline: "2026-09-26" }, now);
  assert.equal(result.level, "urgent");
  assert.equal(result.daysRemaining, -1);
  assert.match(result.reasons[0], /Deadline passed 1 day ago/);
});

test("waiting review and revision are separately explained", () => {
  const result = projectInsights({ ...base, milestones: [
    { status: "submitted", submittedAt: "2026-09-24T10:00:00Z" },
    { status: "revision_requested", revisionRequestedAt: "2026-09-22T10:00:00Z" },
  ] }, now);
  assert.equal(result.level, "attention");
  assert.equal(result.awaitingReview, 1);
  assert.equal(result.revisionsPending, 1);
  assert.ok(result.reasons.some(reason => reason.includes("over 2 days")));
  assert.ok(result.reasons.some(reason => reason.includes("over 3 days")));
});

test("open and completed projects do not create false alerts", () => {
  assert.equal(projectInsights({ ...base, status: "Open", deadline: "2026-09-20" }, now).level, "not_started");
  assert.equal(projectInsights({ ...base, status: "Completed", deadline: "2026-09-20" }, now).level, "complete");
});
