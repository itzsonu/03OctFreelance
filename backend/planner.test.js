const test = require("node:test");
const assert = require("node:assert/strict");
const { suggestMilestones } = require("./planner");

const brief = "Build a responsive client dashboard with account data and clear approval flows.";

test("full-stack brief gets parallel work followed by integration", () => {
  const plan = suggestMilestones({ title: "Client portal", description: brief, requiredSkills: ["React", "Node.js"], budget: 10001 });
  assert.equal(plan.method, "guided_template");
  assert.deepEqual(plan.suggestions.map(step => step.dependsOn), [[], [0], [0], [1, 2]]);
  assert.equal(plan.suggestions.reduce((sum, step) => sum + step.payment, 0), 10001);
  assert.match(plan.explanation, /Review every step/);
});

test("content brief gets an editable sequential draft", () => {
  const plan = suggestMilestones({ title: "Blog launch", description: "Research and write articles for a new public blog, including an editorial review.", requiredSkills: ["Copywriting"], budget: 999.99 });
  assert.deepEqual(plan.suggestions.map(step => step.dependsOn), [[], [0], [1]]);
  assert.equal(plan.suggestions[0].title, "Outline and research");
  assert.equal(plan.suggestions.reduce((sum, step) => sum + step.payment, 0), 999.99);
});

test("invalid project inputs are rejected before planning", () => {
  assert.throws(() => suggestMilestones({ title: "x", description: "short", requiredSkills: ["React"], budget: 100 }), /brief/);
  assert.throws(() => suggestMilestones({ title: "x", description: brief, requiredSkills: [], budget: 100 }), /skills/);
  assert.throws(() => suggestMilestones({ title: "x", description: brief, requiredSkills: ["React"], budget: 0 }), /budget/);
});

test("selected categories override identical technical subject matter", () => {
  const input = { title: "React API guide", description: brief, requiredSkills: ["React", "Node.js"], budget: 100.01 };
  const expectations = {
    "Web Development": "Scope and interfaces",
    "Design & Creative": "Creative brief and concepts",
    "Writing & Translation": "Outline and research",
    Marketing: "Audience and campaign strategy",
    "Data & Analytics": "Data review and preparation",
    "Video & Animation": "Script and storyboard",
    "Admin & Support": "Task scope and onboarding",
  };
  for (const [category, firstStep] of Object.entries(expectations)) {
    const plan = suggestMilestones({ ...input, category });
    assert.equal(plan.suggestions[0].title, firstStep, category);
    assert.match(plan.explanation, new RegExp(category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(Math.round(plan.suggestions.reduce((sum, step) => sum + step.payment, 0) * 100), 10001);
    for (const [index, step] of plan.suggestions.entries()) assert.ok(step.dependsOn.every(prior => prior < index));
  }
});

test("web projects with non-technical briefs still get website phases", () => {
  const plan = suggestMilestones({ category: "Web Development", description: "Create an online presence for a local bakery and present its services.", requiredSkills: ["WordPress"], budget: 500 });
  assert.equal(plan.suggestions[2].title, "Website implementation");
});

test("translation projects get language review instead of software work", () => {
  const plan = suggestMilestones({ category: "Writing & Translation", title: "Translate React docs", description: "Translate documentation for a React application into Hindi for new users.", requiredSkills: ["React", "Translation"], budget: 500 });
  assert.equal(plan.suggestions[1].title, "Translation draft");
  assert.equal(plan.suggestions[2].title, "Language review and delivery");
});

test("Other uses its field, with an honest fallback for unsupported fields", () => {
  const input = { category: "Other", description: brief, requiredSkills: ["React", "Node.js"], budget: 500 };
  const writing = suggestMilestones({ ...input, customCategory: "Technical writing" });
  assert.equal(writing.suggestions[0].title, "Outline and research");
  const translation = suggestMilestones({ ...input, customCategory: "Translation" });
  assert.equal(translation.suggestions[1].title, "Translation draft");
  const architecture = suggestMilestones({ ...input, customCategory: "Architecture" });
  assert.match(architecture.explanation, /no dedicated template/);
  assert.match(architecture.suggestions[0].description, /Architecture/);
  assert.equal(architecture.suggestions[1].title, "Main deliverable");
});

test("invalid category, empty Other field and malformed skills are rejected", () => {
  const input = { description: brief, requiredSkills: ["React"], budget: 500 };
  assert.throws(() => suggestMilestones({ ...input, category: "Unknown" }), /category/);
  for (const customCategory of [undefined, "  ", "x", "x".repeat(81)]) {
    assert.throws(() => suggestMilestones({ ...input, category: "Other", customCategory }), /project field/);
  }
  assert.throws(() => suggestMilestones({ ...input, requiredSkills: ["React", 42] }), /skills/);
});
