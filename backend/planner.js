const { toCents } = require("./money");
const { validateSchedule } = require("./projectDates");
const { validateProjectCategory } = require("./projectCategories");

function fieldTemplate(field) {
  if (/\b(writing|translation|copywriting|content|editorial|blog|article)\b/i.test(field)) return "Writing & Translation";
  if (/\b(web|frontend|backend|full.?stack|website)\b/i.test(field)) return "Web Development";
  if (/\b(design|branding|illustration|creative|logo)\b/i.test(field)) return "Design & Creative";
  if (/\b(marketing|seo|advertising|campaign)\b/i.test(field)) return "Marketing";
  if (/\b(data|analytics|analysis|machine learning)\b/i.test(field)) return "Data & Analytics";
  if (/\b(video|animation|film|motion)\b/i.test(field)) return "Video & Animation";
  if (/\b(admin|support|virtual assistant)\b/i.test(field)) return "Admin & Support";
  return "Other";
}

function suggestMilestones({ title, description, category, customCategory, requiredSkills, budget, deadline }) {
  if (deadline !== undefined && deadline !== "") validateSchedule(deadline);
  const field = validateProjectCategory({ category, customCategory });
  const brief = typeof description === "string" ? description.trim() : "";
  const skills = Array.isArray(requiredSkills) ? requiredSkills.map(skill => typeof skill === "string" ? skill.trim() : "") : [];
  const amount = Number(budget);
  if (brief.length < 30 || brief.length > 3000) throw new Error("Add a project brief of 30–3000 characters first");
  if (!skills.length || skills.length > 10 || skills.some(skill => !skill || skill.length > 40)) throw new Error("Add between 1 and 10 required skills first");
  if (!Number.isFinite(amount) || amount <= 0 || toCents(budget) === null) throw new Error("Add a valid budget first");

  const projectName = typeof title === "string" && title.trim() ? title.trim().slice(0, 90) : "this project";
  const signals = `${field.customCategory} ${title || ""} ${skills.join(" ")} ${brief}`.toLowerCase();
  const frontend = /\b(react|vue|angular|frontend|front-end|ui|ux|figma|web design|responsive|css)\b/.test(signals);
  const backend = /\b(node|backend|back-end|api|database|mongodb|postgres|server|express)\b/.test(signals);
  const content = /\b(content|copywriting|article|blog|writing|editorial)\b/.test(signals);
  const translation = /\b(translat\w*|locali[sz]\w*)\b/.test(signals);
  const selectedCategory = category === "Other" ? fieldTemplate(field.customCategory) : category;
  // Explicit category wins over incidental subject words in the brief.
  const web = selectedCategory === "Web Development" || (!category && (frontend || backend));
  const writing = selectedCategory === "Writing & Translation" || (!category && !web && content);

  let kind;
  let steps;
  let shares;
  if (web && frontend && backend) {
    kind = "frontend and backend";
    shares = [15, 35, 35, 15];
    steps = [
      { title: "Scope and interfaces", description: `Confirm requirements, screen flows and acceptance criteria for ${projectName}.`, dependsOn: [] },
      { title: "Frontend experience", description: `Build the responsive interface for ${projectName} and share it for review.`, dependsOn: [0] },
      { title: "Backend and data", description: `Implement the API and data flow needed for ${projectName}.`, dependsOn: [0] },
      { title: "Integration and handoff", description: "Connect both parts, test the main user flows and hand over the final work.", dependsOn: [1, 2] },
    ];
  } else if (web && frontend) {
    kind = "interface or design";
    shares = [25, 50, 25];
    steps = [
      { title: "Research and wireframes", description: `Agree on the user flow and first visual direction for ${projectName}.`, dependsOn: [] },
      { title: "Design and build", description: `Deliver the main interface for ${projectName} and share it for review.`, dependsOn: [0] },
      { title: "Review and handoff", description: "Address agreed feedback, check responsive behavior and hand over final files.", dependsOn: [1] },
    ];
  } else if (web && backend) {
    kind = "backend or API";
    shares = [25, 50, 25];
    steps = [
      { title: "Requirements and API plan", description: `Define data, endpoints and acceptance criteria for ${projectName}.`, dependsOn: [] },
      { title: "Core implementation", description: `Build the server-side functionality for ${projectName}.`, dependsOn: [0] },
      { title: "Testing and handoff", description: "Test the key flows, resolve defects and hand over code and setup notes.", dependsOn: [1] },
    ];
  } else if (web) {
    kind = "web development";
    shares = [20, 25, 40, 15];
    steps = [
      { title: "Requirements and site plan", description: `Confirm pages, features and acceptance criteria for ${projectName}.`, dependsOn: [] },
      { title: "Layout and design approval", description: "Prepare page layouts and agree on the visual direction before development.", dependsOn: [0] },
      { title: "Website implementation", description: `Build the agreed website features for ${projectName}.`, dependsOn: [1] },
      { title: "Testing and launch handoff", description: "Check functionality and responsive layouts, resolve defects and deliver setup notes.", dependsOn: [2] },
    ];
  } else if (writing && translation) {
    kind = "translation";
    shares = [25, 50, 25];
    steps = [
      { title: "Source review and terminology", description: `Confirm source and target languages, audience and glossary for ${projectName}.`, dependsOn: [] },
      { title: "Translation draft", description: "Translate the agreed material, preserving meaning, tone and formatting for review.", dependsOn: [0] },
      { title: "Language review and delivery", description: "Check terminology, accuracy and grammar, apply feedback and deliver final translated files.", dependsOn: [1] },
    ];
  } else if (writing) {
    kind = "content";
    shares = [25, 50, 25];
    steps = [
      { title: "Outline and research", description: `Confirm audience, outline and references for ${projectName}.`, dependsOn: [] },
      { title: "Draft deliverables", description: `Write the agreed content for ${projectName} and share a review draft.`, dependsOn: [0] },
      { title: "Edit and handoff", description: "Apply agreed edits, proofread and deliver final content files.", dependsOn: [1] },
    ];
  } else if (selectedCategory === "Design & Creative") {
    kind = "design and creative";
    shares = [25, 50, 25];
    steps = [
      { title: "Creative brief and concepts", description: `Confirm audience, style, formats and initial concepts for ${projectName}.`, dependsOn: [] },
      { title: "Design production", description: "Develop the selected visual direction and share design assets for review.", dependsOn: [0] },
      { title: "Refinement and asset handoff", description: "Apply agreed feedback and deliver editable source files and final exports.", dependsOn: [1] },
    ];
  } else if (selectedCategory === "Marketing") {
    kind = "marketing";
    shares = [25, 50, 25];
    steps = [
      { title: "Audience and campaign strategy", description: `Agree on audience, channels, campaign goals and measurement for ${projectName}.`, dependsOn: [] },
      { title: "Campaign assets and execution", description: "Prepare messaging and channel assets, then execute the agreed campaign activities.", dependsOn: [0] },
      { title: "Performance review and recommendations", description: "Review available campaign metrics and deliver findings and next-step recommendations.", dependsOn: [1] },
    ];
  } else if (selectedCategory === "Data & Analytics") {
    kind = "data and analytics";
    shares = [25, 50, 25];
    steps = [
      { title: "Data review and preparation", description: `Confirm questions, data access and quality checks for ${projectName}.`, dependsOn: [] },
      { title: "Analysis and deliverables", description: "Produce the agreed analysis, dashboard or model outputs with documented methods.", dependsOn: [0] },
      { title: "Validation and findings handoff", description: "Check results against agreed criteria and deliver findings, working files and limitations.", dependsOn: [1] },
    ];
  } else if (selectedCategory === "Video & Animation") {
    kind = "video and animation";
    shares = [25, 50, 25];
    steps = [
      { title: "Script and storyboard", description: `Agree on story, duration, style and delivery formats for ${projectName}.`, dependsOn: [] },
      { title: "Production and rough cut", description: "Create footage or animation and share a rough cut for review.", dependsOn: [0] },
      { title: "Final edit and export", description: "Apply feedback, check audio and visuals, and deliver final exports and agreed source assets.", dependsOn: [1] },
    ];
  } else if (selectedCategory === "Admin & Support") {
    kind = "admin and support";
    shares = [25, 50, 25];
    steps = [
      { title: "Task scope and onboarding", description: `Agree on tasks, access, procedures and completion criteria for ${projectName}.`, dependsOn: [] },
      { title: "Task execution and progress review", description: "Complete the agreed support work and share progress records for review.", dependsOn: [0] },
      { title: "Quality check and handover", description: "Verify completed tasks and deliver final records, procedure notes and outstanding items.", dependsOn: [1] },
    ];
  } else {
    kind = "general project";
    shares = [25, 50, 25];
    steps = [
      { title: "Scope and plan", description: `Agree on ${field.customCategory ? `${field.customCategory} ` : ""}deliverables and acceptance criteria for ${projectName}.`, dependsOn: [] },
      { title: "Main deliverable", description: `Complete the agreed ${field.customCategory ? `${field.customCategory} ` : ""}work for ${projectName} and share it for review.`, dependsOn: [0] },
      { title: "Review and handoff", description: "Address agreed feedback and hand over the final deliverables.", dependsOn: [1] },
    ];
  }

  const cents = toCents(amount);
  let allocated = 0;
  const suggestions = steps.map((step, index) => {
    const paymentCents = index === steps.length - 1 ? cents - allocated : Math.floor(cents * shares[index] / 100);
    allocated += paymentCents;
    return { ...step, payment: paymentCents / 100 };
  });

  return {
    method: "guided_template",
    explanation: category
      ? `Template draft for ${category === "Other" ? field.customCategory : category}${category === "Other" && selectedCategory === "Other" ? "; a general delivery structure is used because this field has no dedicated template" : `, using the ${kind} workflow`}. Review every step, prerequisite and planned amount before publishing.`
      : `Template draft based on ${kind} signals in the brief and skills. Review every step, prerequisite and planned amount before publishing.`,
    suggestions,
  };
}

module.exports = { suggestMilestones };
