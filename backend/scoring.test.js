const test = require("node:test");
const assert = require("node:assert/strict");
const { trustFromProjects, matchApplicant } = require("./scoring");

test("cold-start freelancer is unscored, not assigned a made-up trust value", () => {
  assert.deepEqual(trustFromProjects([]), {
    score: null, label: "New on FreelanceChain", approvedMilestones: 0, completedProjects: 0, revisionRequests: 0, scoredMilestones: 0, clientCount: 0,
  });
});

test("trust uses approved work and limits repeated revision impact", () => {
  const clean = trustFromProjects([{ status: "Completed", milestones: [{ status: "completed", revisionCount: 0 }, { status: "completed", revisionCount: 0 }] }]);
  const revised = trustFromProjects([{ status: "Completed", milestones: [{ status: "completed", revisionCount: 1 }, { status: "completed", revisionCount: 0 }] }]);
  const repeated = trustFromProjects([{ status: "Completed", milestones: [{ status: "completed", revisionCount: 8 }, { status: "completed", revisionCount: 0 }] }]);
  assert.equal(clean.approvedMilestones, 2);
  assert.equal(clean.completedProjects, 1);
  assert.ok(clean.score > revised.score);
  assert.equal(revised.score, repeated.score);
  assert.equal(repeated.revisionRequests, 8);
});

test("pending or active milestones do not affect the verified score", () => {
  assert.deepEqual(trustFromProjects([{ status: "In Progress", milestones: [{ status: "active", revisionCount: 5 }, { status: "submitted", revisionCount: 1 }] }]).score, null);
});

test("sparse approved history counts only completed milestones and keeps the small-sample adjustment", () => {
  const trust = trustFromProjects([{ client: "client-one", status: "In Progress", milestones: [
    { status: "completed", revisionCount: 0 },
    { status: "active", revisionCount: 4 },
    { status: "submitted", revisionCount: 2 },
  ] }]);

  assert.equal(trust.approvedMilestones, 1);
  assert.equal(trust.scoredMilestones, 1);
  assert.equal(trust.revisionRequests, 0);
  assert.equal(trust.completedProjects, 0);
  assert.equal(trust.score, 68);
});

test("many approvals from one client cannot inflate scored evidence indefinitely", () => {
  const project = count => ({ client: "client-one", status: "Completed", milestones: Array.from({ length: count }, () => ({ status: "completed", revisionCount: 0 })) });
  const three = trustFromProjects([project(3)]);
  const twenty = trustFromProjects([project(10), project(10)]);
  assert.equal(three.score, twenty.score);
  assert.equal(twenty.approvedMilestones, 20);
  assert.equal(twenty.scoredMilestones, 3);
  assert.equal(twenty.clientCount, 1);
  assert.equal(twenty.label, "Limited client history");
  const revisedThree = trustFromProjects([{ client: "client-one", status: "Completed", milestones: [0, 0, 1].map(revisionCount => ({ status: "completed", revisionCount })) }]);
  const revisedTwenty = trustFromProjects([{ client: "client-one", status: "Completed", milestones: [1, ...Array(19).fill(0)].map(revisionCount => ({ status: "completed", revisionCount })) }]);
  assert.equal(revisedThree.score, revisedTwenty.score);
});

test("legacy approvals without stored client IDs share one conservative evidence cap", () => {
  const legacyProjects = Array.from({ length: 4 }, (_, index) => ({
    _id: `legacy-${index}`,
    status: "Completed",
    milestones: [{ status: "completed", revisionCount: 0 }],
  }));
  const trust = trustFromProjects(legacyProjects);

  assert.equal(trust.score, 77);
  assert.equal(trust.approvedMilestones, 4);
  assert.equal(trust.scoredMilestones, 3);
  assert.equal(trust.clientCount, 0);
});

test("different client accounts add evidence, while revised approvals keep priority under the cap", () => {
  const work = (client, revisionCounts) => ({ client, status: "Completed", milestones: revisionCounts.map(revisionCount => ({ status: "completed", revisionCount })) });
  const oneClient = trustFromProjects([work("client-one", [0, 0, 0, 0])]);
  const twoClients = trustFromProjects([work("client-one", [0, 0, 0, 0]), work("client-two", [0, 0, 0, 0])]);
  const revised = trustFromProjects([work("client-one", [0, 0, 0, 0]), work("client-two", [1, 1, 1, 1])]);
  assert.equal(twoClients.scoredMilestones, 6);
  assert.equal(twoClients.clientCount, 2);
  assert.equal(twoClients.label, "Multiple client accounts");
  assert.ok(twoClients.score > oneClient.score);
  assert.ok(revised.score < twoClients.score);
});

test("trust evidence is independent of project ordering", () => {
  const project = (client, milestones, id) => ({
    ...(id ? { _id: id } : {}),
    ...(client ? { client } : {}),
    status: "Completed",
    milestones,
  });
  const projects = [
    project("client-one", [0, 1, 0, 0].map(revisionCount => ({ status: "completed", revisionCount }))),
    project("client-two", [0, 0, 0, 0].map(revisionCount => ({ status: "completed", revisionCount }))),
    project(null, [0, 0].map(revisionCount => ({ status: "completed", revisionCount })), "legacy-one"),
    project(null, [0, 1].map(revisionCount => ({ status: "completed", revisionCount })), "legacy-two"),
    project("client-three", [{ status: "active", revisionCount: 5 }]),
  ];

  assert.deepEqual(trustFromProjects(projects), trustFromProjects([...projects].reverse()));
});

test("matching explains skills and does not invent a trust score for new freelancers", () => {
  const match = matchApplicant(["Figma", "Branding"], { skills: ["figma"], experienceYears: 4 }, { score: null });
  assert.deepEqual(match.matchedSkills, ["Figma"]);
  assert.deepEqual(match.missingSkills, ["Branding"]);
  assert.equal(match.trustIncluded, false);
  assert.equal(match.score, 55);
});

test("project context can distinguish equal-skill applicants without scoring missing history", () => {
  const project = { title: "Mobile UX study", description: "Research the mobile checkout journey and design testable Figma flows.", requiredSkills: ["Figma"] };
  const researcher = matchApplicant(
    ["Figma"],
    { skills: ["Figma"], experienceYears: 2, bio: "Mobile checkout research, usability studies, and journey mapping." },
    { score: null },
    { project, proposal: "I will test checkout flows with users." }
  );
  const brandDesigner = matchApplicant(
    ["Figma"],
    { skills: ["Figma"], experienceYears: 6, bio: "I create brand logos and social graphics." },
    { score: null },
    { project, proposal: "I can design a new logo." }
  );

  assert.ok(researcher.score > brandDesigner.score);
  assert.equal(researcher.factorScores.requiredSkills, 100);
  assert.equal(researcher.factorScores.verifiedTrust, null);
  assert.ok(researcher.contextMatchedTerms.includes("checkout"));
  assert.equal(researcher.trustIncluded, false);
  assert.match(researcher.method, /Missing platform history is not scored/);
});

test("profile context outweighs proposal keyword repetition in a misleading match", () => {
  const project = { title: "Patient instruction explainer animation", description: "Create a short 2D animated explainer for pediatric patients, with clear medication steps and accessible captions.", requiredSkills: ["After Effects"] };
  const healthcareDesigner = matchApplicant(
    ["After Effects"],
    { skills: ["After Effects"], experienceYears: 2, headline: "Healthcare motion designer", bio: "Patient education animations, medication instructions, and captioned explainers." },
    { score: null },
    { project, proposal: "I will storyboard the medication steps and deliver captioned 2D animation." }
  );
  const keywordRepeater = matchApplicant(
    ["After Effects"],
    { skills: ["After Effects"], experienceYears: 7, headline: "Commercial video editor", bio: "Restaurant ads, product reels, and event recaps." },
    { score: null },
    { project, proposal: "Pediatric patients, medication instructions, accessible captions, and 2D explainer animation are brief keywords; I edit commercial videos." }
  );

  assert.ok(healthcareDesigner.score > keywordRepeater.score);
  assert.ok(keywordRepeater.contextProposalScore > keywordRepeater.contextProfileScore);
});

test("common framework spellings match without treating distinct skills as equivalent", () => {
  const match = matchApplicant(["React", "Node.js", "React Native"], { skills: ["ReactJS", "NodeJS"], experienceYears: 2 }, { score: null });
  assert.deepEqual(match.matchedSkills, ["React", "Node.js"]);
  assert.deepEqual(match.missingSkills, ["React Native"]);
});

test("budget and availability provide independent compatibility without changing fit or cold-start handling", () => {
  const profile = { skills: ["React"], experienceYears: 2, availability: "limited" };
  const project = { budget: 100.29 };
  const within = matchApplicant(["React"], profile, { score: null }, { project, proposedPrice: 100.29 });
  const above = matchApplicant(["React"], { ...profile, availability: "unavailable" }, { score: null }, { project, proposedPrice: 120.29 });
  assert.equal(within.compatibility.budget, "within_budget");
  assert.equal(within.compatibility.availability, "limited");
  assert.equal(above.compatibility.budget, "above_budget");
  assert.equal(above.compatibility.budgetDifference, 20);
  assert.equal(above.compatibility.availability, "unavailable");
  assert.equal(within.score, above.score);
  assert.equal(within.trustIncluded, false);
  const unknown = matchApplicant([], {}, { score: null }, { project });
  assert.equal(unknown.compatibility.budget, "unknown");
  assert.equal(unknown.compatibility.availability, "unknown");
});
