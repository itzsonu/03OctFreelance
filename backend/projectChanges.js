const mongoose = require("mongoose");
const { toCents } = require("./money");
const { validDate, todayISO } = require("./projectDates");
const { dependencyIds } = require("./workflow");

const hasWork = step => step.status === "completed" || !!step.submittedWork || !!step.submissions?.length || !!step.revisionRequests?.length || !!step.revisionCount;
function normalizeChange(project, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Provide the proposed project terms");
  const scope = typeof input.scope === "string" ? input.scope.trim() : "";
  const cents = toCents(input.amount);
  if (scope.length < 10 || scope.length > 5000 || cents === null || cents <= 0 || cents > 100_000_000_000) throw new Error("Add a scope of 10–5000 characters and a valid positive amount");
  const deliveryDate = input.deliveryDate;
  if (!validDate(deliveryDate) || deliveryDate < todayISO()) throw new Error("Choose a delivery date of today or later");
  if (!Array.isArray(input.milestones) || !input.milestones.length || input.milestones.length > 20) throw new Error("Add between 1 and 20 milestones");
  const old = new Map(project.milestones.map((step, i) => [String(step._id), { step, index: i }]));
  const seen = new Set();
  const milestones = input.milestones.map((item, i) => {
    if (!item || typeof item !== "object") throw new Error(`Milestone ${i + 1} is invalid`);
    const milestoneId = item.milestoneId || null;
    if (milestoneId && (typeof milestoneId !== "string" || !old.has(milestoneId) || seen.has(milestoneId))) throw new Error("Existing milestone IDs must be unique and belong to this project");
    if (milestoneId) seen.add(milestoneId);
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const description = typeof item.description === "string" ? item.description.trim() : "";
    const payment = toCents(item.payment);
    const dueDate = item.dueDate || "";
    const dependsOn = item.dependsOn ?? (i ? [i - 1] : []);
    if (!title || title.length > 120 || description.length > 1000 || payment === null || payment < 0) throw new Error(`Milestone ${i + 1} needs a title, valid planned amount and details of up to 1000 characters`);
    if (!Array.isArray(dependsOn) || new Set(dependsOn).size !== dependsOn.length || dependsOn.some(index => !Number.isInteger(index) || index < 0 || index >= i)) throw new Error(`Milestone ${i + 1} has invalid prerequisites`);
    const previous = milestoneId && old.get(milestoneId).step;
    if (previous?.status !== "completed" && dueDate && (!validDate(dueDate) || dueDate < todayISO() || dueDate > deliveryDate)) throw new Error(`Milestone ${i + 1} target date must be between today and delivery`);
    return { milestoneId, title, description, payment: payment / 100, dueDate, dependsOn: [...dependsOn].sort((a, b) => a - b) };
  });
  for (const [id, { step }] of old) if (hasWork(step) && !seen.has(id)) throw new Error("Milestones with approved or submitted work cannot be removed");
  milestones.forEach((item, i) => {
    const previous = item.milestoneId && old.get(item.milestoneId);
    if (previous && hasWork(previous.step)) {
      const before = dependencyIds(project, previous.index).sort();
      const after = item.dependsOn.map(index => milestones[index].milestoneId || "new").sort();
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Prerequisites of milestones with recorded work cannot be changed");
      if (previous.step.status === "completed" && ["title", "description", "payment", "dueDate"].some(key => (previous.step[key] || (key === "payment" ? 0 : "")) !== item[key])) throw new Error("Approved milestones and their planned amounts cannot be changed");
    }
    if (item.dueDate && previous?.step.status !== "completed" && item.dependsOn.some(index => {
      const prerequisite = milestones[index];
      return old.get(prerequisite.milestoneId)?.step.status !== "completed" && prerequisite.dueDate && prerequisite.dueDate > item.dueDate;
    })) throw new Error(`Milestone ${i + 1} cannot be due before an unfinished prerequisite`);
  });
  if (milestones.reduce((sum, item) => sum + toCents(item.payment), 0) !== cents) throw new Error("Milestone planned amounts must add up exactly to the proposed total");
  return { scope, amount: cents / 100, deliveryDate, milestones };
}

function applyChange(project, terms) {
  const ids = terms.milestones.map(item => item.milestoneId ? new mongoose.Types.ObjectId(item.milestoneId) : new mongoose.Types.ObjectId());
  const old = new Map(project.milestones.map(step => [String(step._id), step]));
  const completed = new Set(project.milestones.filter(step => step.status === "completed").map(step => String(step._id)));
  return terms.milestones.map((item, i) => {
    const previous = old.get(item.milestoneId);
    const dependsOn = item.dependsOn.map(index => ids[index]);
    const ready = dependsOn.every(id => completed.has(String(id)));
    return { ...(previous ? previous.toObject() : {}), _id: ids[i], title: item.title, description: item.description, payment: item.payment, dueDate: item.dueDate, dependsOn, status: previous && hasWork(previous) ? previous.status : ready ? "active" : "locked" };
  });
}

module.exports = { normalizeChange, applyChange };
