// Incomplete form values are allowed here. Publishing uses the full project validator.
function savedForm(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid draft");
  const text = (value, max) => {
    if (value === undefined) return "";
    if (typeof value !== "string" || value.length > max) throw new Error(`Draft fields must be text within ${max} characters`);
    return value;
  };
  const form = {};
  for (const [key, max] of Object.entries({ title: 120, description: 3000, category: 40, customCategory: 80, requiredSkills: 500, budget: 30, deadline: 10 })) form[key] = text(input[key], max);
  if (!Array.isArray(input.milestones) || !input.milestones.length || input.milestones.length > 20) throw new Error("Keep between 1 and 20 draft milestones");
  form.milestones = input.milestones.map((step, index) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) throw new Error("Invalid draft milestone");
    const dependencies = step.dependsOn ?? [];
    if (!Array.isArray(dependencies) || dependencies.length > index || dependencies.some(i => !Number.isInteger(i) || i < 0 || i >= index) || new Set(dependencies).size !== dependencies.length) throw new Error("Choose only earlier milestone dependencies");
    return { title: text(step.title, 120), description: text(step.description, 1000), payment: text(step.payment, 30), dueDate: text(step.dueDate, 10), dependsOn: dependencies };
  });
  return form;
}
function publishInput(form) {
  return { ...form, requiredSkills: [...new Set(form.requiredSkills.split(",").map(s => s.trim()).filter(Boolean))], budget: Number(form.budget), milestones: form.milestones.map(step => ({ ...step, payment: Number(step.payment || 0) })) };
}
module.exports = { savedForm, publishInput };
