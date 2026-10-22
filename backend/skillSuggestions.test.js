const test = require("node:test");
const assert = require("node:assert/strict");
const { suggestSkills } = require("./skillSuggestions");
const input = { title: "Dashboard", category: "Web Development", description: "Build a React dashboard with Node.js APIs and MongoDB storage. ReactJS is required." };
const names = value => suggestSkills(value).suggestions.map(item => item.skill);

test("extracts canonical named skills with review evidence and no duplicates", () => {
  const result = suggestSkills(input);
  assert.equal(result.method, "catalogue_extraction_v1");
  assert.deepEqual(result.suggestions.map(item => item.skill), ["React", "Node.js", "MongoDB"]);
  assert.equal(result.suggestions[0].matchedTerm, "React");
  assert.match(result.suggestions[1].evidence, /Node.js APIs/);
  assert.ok(result.suggestions.every(item => item.evidence.length <= 140));
});

test("writing about programming suggests writing skills rather than implementation tools", () => {
  const brief = { title: "Technical guide", category: "Writing & Translation", description: "Create a technical guide about React and Node.js APIs, with proofreading and SEO." };
  assert.deepEqual(names(brief), ["Technical writing", "Proofreading", "SEO"]);
  assert.deepEqual(names({ ...brief, category: "Other", customCategory: "Technical writing" }), names(brief));
  assert.deepEqual(names({ title: "Unknown field", category: "Other", customCategory: "Marine science", description: "Review the ocean survey and deliver a final report to the research team." }), []);
  assert.deepEqual(names({ title: "Building plan", category: "Other", customCategory: "Architecture", description: "Prepare the building layout using AutoCAD and SketchUp for review." }), ["AutoCAD", "SketchUp"]);
});

test("respects named-skill boundaries, compound names and common exclusions", () => {
  assert.deepEqual(names({ ...input, description: "Build with React Native and TypeScript. No React or Angular needed. Node.js is optional." }), ["React Native", "TypeScript"]);
  assert.deepEqual(names({ ...input, description: "Prepare reactive layouts and a node diagram with expressive copy for review." }), []);
  assert.deepEqual(names({ ...input, description: "Build in React. MongoDB is not required. Use SQL for the final database storage." }), ["React", "SQL"]);
});

test("validates brief and category, and caps suggestions at ten", () => {
  for (const bad of [null, [], { ...input, description: "short" }, { ...input, title: "a".repeat(121) }, { ...input, category: "Other" }, { ...input, category: undefined }]) assert.throws(() => suggestSkills(bad));
  const result = suggestSkills({ ...input, description: "React, Node.js, JavaScript, TypeScript, HTML, CSS, Next.js, Vue, Angular, MongoDB, Python, SQL, Figma are required for this project." });
  assert.equal(result.suggestions.length, 10);
  assert.equal(result.limited, true);
});

test("each standard field can extract relevant deliverables or tools", () => {
  const examples = [
    ["Design & Creative", "Prepare a brand identity and logo design in Figma for the final review.", ["Branding", "Logo design", "Figma"]],
    ["Marketing", "Prepare an email campaign using Google Ads and Google Analytics for reporting.", ["Email marketing", "Google Ads", "Google Analytics"]],
    ["Data & Analytics", "Perform data analysis using Excel and Power BI and provide a final dashboard.", ["Data analysis", "Excel", "Power BI"]],
    ["Video & Animation", "Complete video editing in Premiere Pro with motion graphics for the launch.", ["Video editing", "Premiere Pro", "Motion graphics"]],
    ["Admin & Support", "Provide customer support and data entry using Google Sheets for our team.", ["Customer support", "Data entry", "Google Sheets"]],
  ];
  for (const [category, description, skills] of examples) assert.deepEqual(names({ title: "Project", category, description }), skills);
});
