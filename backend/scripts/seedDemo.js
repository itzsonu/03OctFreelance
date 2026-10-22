const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");
const Project = require("../models/Project");
const Application = require("../models/Application");
const { buildMilestones } = require("../workflow");

const demoUri = "mongodb://127.0.0.1:27017/freelancechain_demo";
const password = process.env.DEMO_PASSWORD || crypto.randomBytes(12).toString("base64url");

async function upsertUser(name, email, role, profile = {}) {
  return User.findOneAndUpdate(
    { email },
    { $set: { name, role, profile, password: await bcrypt.hash(password, 10) } },
    { upsert: true, returnDocument: "after", runValidators: true }
  );
}

async function upsertProject(client, title, fields) {
  return Project.findOneAndUpdate(
    { client: client._id, title },
    { $set: { ...fields, client: client._id, title } },
    { upsert: true, returnDocument: "after", runValidators: true }
  );
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Demo data cannot be seeded in production");
  if (password.length < 12) throw new Error("DEMO_PASSWORD must have at least 12 characters");
  await mongoose.connect(demoUri);

  const client = await upsertUser("Asha Client", "demo.client@freelancechain.local", "client");
  const experienced = await upsertUser("Riya Developer", "demo.freelancer@freelancechain.local", "freelancer", {
    headline: "React developer and dashboard designer", bio: "I build clear interfaces and work in milestones.",
    skills: ["React", "UI design", "Node.js"], experienceYears: 4, portfolioUrl: "", discoverable: true,
  });
  const newFreelancer = await upsertUser("Dev Newcomer", "demo.new@freelancechain.local", "freelancer", {
    headline: "Frontend developer", bio: "I enjoy building accessible web interfaces.",
    skills: ["React", "CSS"], experienceYears: 1, portfolioUrl: "", discoverable: true,
  });

  const now = new Date();
  const completedSteps = buildMilestones([
    { title: "Plan dashboard", payment: 3000 },
    { title: "Build dashboard", payment: 5000 },
  ]).map((step, index) => ({ ...step, status: "completed", submittedWork: index ? "Responsive dashboard delivered" : "Wireframes delivered", submittedAt: now, approvedAt: now, submissions: [{ work: index ? "Responsive dashboard delivered" : "Wireframes delivered", submittedAt: now }], revisionCount: index ? 1 : 0 }));
  await upsertProject(client, "[DEMO] Completed analytics dashboard", {
    description: "An analytics dashboard that was completed to provide a verified work history for the demo.",
    requiredSkills: ["React", "UI design"], budget: 8000, deadline: "2030-12-31", freelancer: experienced._id,
    status: "Completed", hasExplicitDependencies: true, milestones: completedSteps,
    activity: [{ type: "project_completed", actor: client._id, actorName: client.name, note: "All milestones approved", createdAt: now }],
  });

  const activeSteps = buildMilestones([
    { title: "Design system", payment: 4000 },
    { title: "Build interface", payment: 6000 },
  ]);
  activeSteps[0].status = "submitted";
  activeSteps[0].submittedWork = "Initial design system with color, type and components.";
  activeSteps[0].submittedAt = now;
  activeSteps[0].submissions = [{ work: activeSteps[0].submittedWork, submittedAt: now }];
  await upsertProject(client, "[DEMO] Client portal redesign", {
    description: "Redesign a client portal with a design system, responsive components and a clear review workflow.",
    requiredSkills: ["React", "UI design"], budget: 10000, deadline: "2030-12-31", freelancer: experienced._id,
    status: "In Progress", hasExplicitDependencies: true, milestones: activeSteps,
    activity: [{ type: "work_submitted", actor: experienced._id, actorName: experienced.name, milestoneId: activeSteps[0]._id, milestoneTitle: activeSteps[0].title, note: "Work submitted", createdAt: now }],
  });

  const open = await upsertProject(client, "[DEMO] New booking dashboard", {
    description: "Create a booking dashboard with reusable React components and a friendly responsive interface.",
    requiredSkills: ["React", "UI design"], budget: 12000, deadline: "2030-12-31", freelancer: null,
    status: "Open", hasExplicitDependencies: true, milestones: buildMilestones([
      { title: "Wireframes", payment: 4000 }, { title: "Implementation", payment: 8000 },
    ]), activity: [{ type: "project_created", actor: client._id, actorName: client.name, note: "Project created", createdAt: now }],
  });

  await Application.findOneAndUpdate(
    { project: open._id, freelancer: experienced._id },
    { $set: { proposal: "I will design and build the dashboard in two clear stages.", status: "PENDING" } },
    { upsert: true, returnDocument: "after" }
  );
  await Application.findOneAndUpdate(
    { project: open._id, freelancer: newFreelancer._id },
    { $set: { proposal: "I can build the React screens and keep the design responsive.", status: "PENDING" } },
    { upsert: true, returnDocument: "after" }
  );

  console.log("Demo database: freelancechain_demo (local MongoDB only)");
  console.log(`Demo password for all accounts: ${password}`);
  console.log("Client: demo.client@freelancechain.local");
  console.log("Experienced freelancer: demo.freelancer@freelancechain.local");
  console.log("New freelancer: demo.new@freelancechain.local");
}

main().catch(error => { console.error("Demo seed failed:", error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
