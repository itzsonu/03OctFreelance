const { validateProjectCategory } = require("./projectCategories");

// A bounded, explainable catalogue, not a trained model or a claim of proficiency.
const families = {
  "Web Development": "web", "Design & Creative": "design", "Writing & Translation": "writing",
  Marketing: "marketing", "Data & Analytics": "data", "Video & Animation": "video", "Admin & Support": "admin",
};
const catalogue = [
  ["React Native", ["react native"], "web"],
  ["React", ["react", "react.js", "reactjs"], "web"],
  ["Node.js", ["node.js", "nodejs", "node js"], "web"],
  ["JavaScript", ["javascript", "java script"], "web"],
  ["TypeScript", ["typescript"], "web"],
  ["HTML", ["html", "html5"], "web"], ["CSS", ["css", "css3"], "web"],
  ["Next.js", ["next.js", "nextjs"], "web"], ["Vue", ["vue", "vue.js", "vuejs"], "web"],
  ["Angular", ["angular"], "web"], ["Express", ["express.js", "expressjs", "express api"], "web"],
  ["MongoDB", ["mongodb", "mongo db"], "web data"], ["SQL", ["sql", "mysql", "postgresql"], "web data"],
  ["Python", ["python"], "web data"], ["Django", ["django"], "web"], ["PHP", ["php"], "web"],
  ["WordPress", ["wordpress", "word press"], "web writing marketing"],
  ["Figma", ["figma"], "web design"], ["UI design", ["ui design", "user interface design"], "web design"],
  ["UX design", ["ux design", "user experience design"], "web design"],
  ["Branding", ["branding", "brand identity", "visual identity"], "design marketing"],
  ["Logo design", ["logo design", "design a logo"], "design"],
  ["Photoshop", ["photoshop"], "design video"], ["Illustrator", ["adobe illustrator", "illustrator"], "design"],
  ["Canva", ["canva"], "design marketing"], ["Illustration", ["illustration", "illustrations"], "design"],
  ["Technical writing", ["technical writing", "technical guide", "api documentation"], "writing"],
  ["Content writing", ["content writing", "blog post", "blog posts", "write an article", "write articles"], "writing marketing"],
  ["Copywriting", ["copywriting", "copy writing", "sales copy", "website copy"], "writing marketing"],
  ["Proofreading", ["proofreading", "proofread"], "writing"],
  ["Editing", ["copy editing", "copyediting", "edit the article", "editorial editing"], "writing"],
  ["Translation", ["translation", "translate"], "writing"],
  ["SEO", ["seo", "search engine optimization", "search engine optimisation"], "web writing marketing"],
  ["Social media marketing", ["social media marketing", "social media campaign"], "marketing"],
  ["Email marketing", ["email marketing", "email campaign"], "marketing"],
  ["Google Ads", ["google ads", "adwords"], "marketing"], ["Google Analytics", ["google analytics", "ga4"], "marketing data"],
  ["Market research", ["market research"], "marketing data"],
  ["Excel", ["excel", "microsoft excel"], "data admin"], ["Google Sheets", ["google sheets"], "data admin"],
  ["Data analysis", ["data analysis", "analyze data", "analyse data"], "data"],
  ["Data visualization", ["data visualization", "data visualisation"], "data"],
  ["Power BI", ["power bi", "powerbi"], "data"], ["Tableau", ["tableau"], "data"],
  ["Machine learning", ["machine learning"], "data"], ["Pandas", ["pandas"], "data"],
  ["Video editing", ["video editing", "edit a video", "edit videos"], "video"],
  ["Premiere Pro", ["premiere pro"], "video"], ["After Effects", ["after effects"], "video"],
  ["DaVinci Resolve", ["davinci resolve"], "video"], ["Blender", ["blender"], "design video"],
  ["Animation", ["animation", "animate"], "video"], ["Motion graphics", ["motion graphics"], "video"],
  ["Data entry", ["data entry"], "admin data"], ["Customer support", ["customer support", "customer service"], "admin"],
  ["Virtual assistance", ["virtual assistant", "virtual assistance"], "admin"],
  ["Transcription", ["transcription", "transcribe"], "admin writing"],
  ["AutoCAD", ["autocad"], "other"], ["SketchUp", ["sketchup"], "other"],
  ["Legal research", ["legal research"], "other"], ["Unity", ["unity engine", "unity3d", "unity 3d"], "other"],
].map(([skill, aliases, groups]) => ({ skill, aliases, groups: groups.split(" ") }));

function fieldFamily(category, customCategory) {
  if (families[category]) return families[category];
  // Respect explicit custom fields; an unfamiliar field remains open to catalogue matches.
  const field = customCategory.toLowerCase();
  if (/writ|translat|editor|proofread/.test(field)) return "writing";
  if (/web|software|app development/.test(field)) return "web";
  if (/design|illustrat|brand/.test(field)) return "design";
  if (/marketing/.test(field)) return "marketing";
  if (/data|analytics/.test(field)) return "data";
  if (/video|animation/.test(field)) return "video";
  if (/admin|support/.test(field)) return "admin";
  return null;
}

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function excluded(text, start, end) {
  const before = text.slice(Math.max(0, start - 65), start).split(/[.!?;\n]/).pop();
  const after = text.slice(end, end + 45);
  return /\b(?:no|without|not|exclude|excluding|don't need|do not need|not required|not needed)(?:\s+[\w+.-]+){0,4}\s*$/i.test(before)
    || /^\s+(?:is |are )?(?:not required|not needed|excluded|optional|not necessary)\b/i.test(after);
}

function suggestSkills(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Supply a project brief");
  const { category, customCategory } = validateProjectCategory(input);
  if (!category) throw new Error("Choose a valid project category");
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (title.length > 120 || description.length < 30 || description.length > 3000) throw new Error("Use a title of up to 120 characters and a brief of 30–3000 characters");
  const text = `${title}\n${description}`;
  const family = fieldFamily(category, customCategory);
  const hits = [];
  for (const entry of catalogue) {
    if (family && !entry.groups.includes(family)) continue;
    for (const alias of entry.aliases) {
      const expression = new RegExp(`(?<![\\p{L}\\p{N}_])${escape(alias)}(?![\\p{L}\\p{N}_])`, "giu");
      for (const match of text.matchAll(expression)) {
        const start = match.index;
        const end = start + match[0].length;
        if (!excluded(text, start, end)) hits.push({ entry, start, end, term: match[0] });
      }
    }
  }
  // Prefer a longer named skill over a contained one (React Native vs React).
  const spans = [];
  for (const hit of hits.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)) {
    if (!spans.some(other => hit.start < other.end && hit.end > other.start)) spans.push(hit);
  }
  const distinct = new Map();
  for (const hit of spans.sort((a, b) => a.start - b.start)) {
    if (!distinct.has(hit.entry.skill)) distinct.set(hit.entry.skill, {
      skill: hit.entry.skill, aliases: hit.entry.aliases, matchedTerm: hit.term,
      evidence: text.slice(Math.max(0, hit.start - 35), Math.min(text.length, hit.end + 65)).replace(/\s+/g, " ").trim(),
    });
  }
  return {
    method: "catalogue_extraction_v1", suggestions: [...distinct.values()].slice(0, 10), limited: distinct.size > 10,
    explanation: "Suggestions match named tools or work terms in your brief and selected field. Review each before adding it. This catalogue can miss skills; you can always type your own. No external AI request is made.",
  };
}

module.exports = { suggestSkills };
