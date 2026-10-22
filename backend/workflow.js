const mongoose = require("mongoose");

function buildMilestones(items) {
  const ids = items.map(() => new mongoose.Types.ObjectId());
  return items.map((item, index) => {
    const dependencies = item.dependsOn === undefined ? (index ? [index - 1] : []) : item.dependsOn;
    if (!Array.isArray(dependencies) || dependencies.some(value => !Number.isInteger(value) || value < 0 || value >= index) || new Set(dependencies).size !== dependencies.length) {
      throw new Error(`Milestone ${index + 1} has invalid dependencies`);
    }
    return {
      _id: ids[index],
      title: item.title,
      description: item.description || "",
      payment: item.payment || 0,
      dueDate: item.dueDate || "",
      dependsOn: dependencies.map(value => ids[value]),
      status: dependencies.length ? "locked" : "active",
    };
  });
}

function dependencyIds(project, index) {
  if (!project.hasExplicitDependencies) {
    return index ? [project.milestones[index - 1]._id.toString()] : [];
  }
  return (project.milestones[index].dependsOn || []).map(id => id.toString());
}

function unlockReadyMilestones(project) {
  const completed = new Set(project.milestones.filter(item => item.status === "completed").map(item => item._id.toString()));
  const unlocked = [];
  project.milestones.forEach((item, index) => {
    if (item.status === "locked" && dependencyIds(project, index).every(id => completed.has(id))) {
      item.status = "active";
      unlocked.push(item);
    }
  });
  return unlocked;
}

module.exports = { buildMilestones, dependencyIds, unlockReadyMilestones };
