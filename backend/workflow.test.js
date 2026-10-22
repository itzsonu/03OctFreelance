const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMilestones, dependencyIds, unlockReadyMilestones } = require("./workflow");

test("explicit dependencies unlock only after every prerequisite is approved", () => {
  const milestones = buildMilestones([
    { title: "Design", dependsOn: [] },
    { title: "Copy", dependsOn: [] },
    { title: "Launch", dependsOn: [0, 1] },
  ]);
  const project = { hasExplicitDependencies: true, milestones };
  assert.deepEqual(milestones.map(item => item.status), ["active", "active", "locked"]);
  milestones[0].status = "completed";
  assert.equal(unlockReadyMilestones(project).length, 0);
  milestones[1].status = "completed";
  assert.deepEqual(unlockReadyMilestones(project).map(item => item.title), ["Launch"]);
  assert.equal(unlockReadyMilestones(project).length, 0);
});

test("invalid or forward dependencies are rejected", () => {
  assert.throws(() => buildMilestones([{ title: "First", dependsOn: [1] }, { title: "Second" }]), /invalid dependencies/);
  assert.throws(() => buildMilestones([{ title: "First" }, { title: "Second", dependsOn: [0, 0] }]), /invalid dependencies/);
});

test("older projects retain sequential prerequisites", () => {
  const milestones = buildMilestones([{ title: "First" }, { title: "Second" }]);
  const project = { milestones, hasExplicitDependencies: false };
  assert.deepEqual(dependencyIds(project, 1), [milestones[0]._id.toString()]);
  milestones[0].status = "completed";
  assert.deepEqual(unlockReadyMilestones(project).map(item => item.title), ["Second"]);
});
