const { validateProjectCategory } = require("./projectCategories");
const { toCents } = require("./money");
const { validateSchedule } = require("./projectDates");
const { buildMilestones } = require("./workflow");

function normalizeProjectDraft(input = {}) {
  const field = validateProjectCategory(input);
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!title || title.length > 120 || description.length < 30 || description.length > 3000) throw new Error("Add a title and a project brief of 30–3000 characters");
  if (!Array.isArray(input.requiredSkills) || !input.requiredSkills.length || input.requiredSkills.length > 10 || input.requiredSkills.some(skill => typeof skill !== "string" || !skill.trim() || skill.trim().length > 40)) throw new Error("Add between 1 and 10 required skills");
  const requiredSkills = [...new Map(input.requiredSkills.map(skill => [skill.trim().toLowerCase(), skill.trim()])).values()];
  const cents = toCents(input.budget);
  if (cents === null || cents <= 0) throw new Error("Budget must be a number greater than 0");
  let items = input.milestones;
  if (!Array.isArray(items)) {
    const count = Number(items);
    if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("Add between 1 and 20 milestones");
    items = Array.from({ length: count }, (_, i) => ({ title: `Milestone ${i + 1}`, payment: (Math.floor(cents / count) + (i < cents % count ? 1 : 0)) / 100 }));
  }
  if (!items.length || items.length > 20) throw new Error("Add between 1 and 20 milestones");
  items = items.map((item, i) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Milestone ${i + 1} is invalid`);
    const name = typeof item.title === "string" ? item.title.trim() : "";
    const detail = typeof item.description === "string" ? item.description.trim() : "";
    const payment = toCents(item.payment ?? 0);
    if (!name || name.length > 120 || detail.length > 1000 || payment === null || payment < 0) throw new Error(`Milestone ${i + 1} needs a title, valid amount and details of up to 1000 characters`);
    return { title: name, description: detail, payment: payment / 100, dueDate: item.dueDate ?? "", dependsOn: item.dependsOn };
  });
  if (items.reduce((sum, item) => sum + toCents(item.payment), 0) > cents) throw new Error("Total milestone payments cannot exceed the project budget");
  validateSchedule(input.deadline, items);
  return { title, description, ...field, requiredSkills, budget: cents / 100, deadline: input.deadline, milestones: buildMilestones(items), hasExplicitDependencies: true };
}

function listingSnapshot(project) {
  const { title, description, category, customCategory, requiredSkills, budget, deadline, milestones, hasExplicitDependencies } = project.toObject();
  return { title, description, category, customCategory, requiredSkills, budget, deadline, hasExplicitDependencies, milestones: milestones.map(({ _id, title, description, payment, dueDate, dependsOn }) => ({ _id, title, description, payment, dueDate, dependsOn })) };
}

module.exports = { normalizeProjectDraft, listingSnapshot };
