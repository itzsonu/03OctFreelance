const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.PRIVATE_UPLOAD_BACKEND = "mongo";
process.env.EVENT_EMAILS_ENABLED = "false";
const app = require("./app");
const User = require("./models/User");
const Project = require("./models/Project");
const Application = require("./models/Application");
const Message = require("./models/Message");
const { saveAttachments } = require("./attachmentStorage");
const { testSession, authHeaders } = require("./testSession");

test("conversation downloads stay private before and after hiring while project evidence remains accessible", async () => {
  const database = "freelancechain_attachment_access_test_" + crypto.randomBytes(8).toString("hex");
  let server;
  try {
    await mongoose.connect((process.env.TEST_MONGO_BASE || "mongodb://127.0.0.1:27017") + "/" + database, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([User.init(), Application.init(), Message.init(), require("./models/Attachment").init()]);
    await require("./mongoFileStorage").init();
    async function person(role, name) {
      const user = await User.create({ role, name, email: name + "@example.test", password: "unused-test-password" });
      return { user, auth: await testSession(user) };
    }
    const client = await person("client", "owner");
    const applicant = await person("freelancer", "applicant");
    const selected = await person("freelancer", "selected");
    const outsider = await person("freelancer", "outsider");
    const project = await Project.create({ client: client.user._id, title: "Attachment access regression", budget: 100, deadline: "2035-12-31" });
    const first = await Application.create({ project: project._id, freelancer: applicant.user._id });
    const second = await Application.create({ project: project._id, freelancer: selected.user._id });
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = "http://127.0.0.1:" + server.address().port + "/api";
    async function upload(application, actor, text) {
      const body = new FormData();
      body.append("files", new Blob([text], { type: "text/plain" }), "notes.txt");
      const response = await fetch(base + "/messages/application/" + application._id, { method: "POST", headers: authHeaders(actor.auth), body });
      const result = await response.json();
      assert.equal(response.status, 201, JSON.stringify(result));
      return result.attachments[0].id;
    }
    async function download(id, actor, expected, text, projectId = project._id) {
      const response = await fetch(base + "/workrooms/projects/" + projectId + "/files/" + id, { headers: authHeaders(actor?.auth) });
      const content = await response.text();
      assert.equal(response.status, expected, (actor?.user.name || "guest") + ": " + content);
      if (expected === 200) {
        assert.equal(content, text);
        assert.match(response.headers.get("content-disposition"), /^attachment;/);
      }
    }
    // Both sides can download their own conversation; knowing another ID grants no access.
    const firstFile = await upload(first, applicant, "Applicant's private approach");
    const clientFile = await upload(first, client, "Client's private reference");
    const secondFile = await upload(second, selected, "Selected applicant's approach");
    await download(firstFile, applicant, 200, "Applicant's private approach");
    await download(clientFile, applicant, 200, "Client's private reference");
    await download(firstFile, client, 200, "Applicant's private approach");
    await download(firstFile, selected, 403);
    await download(secondFile, applicant, 403);
    await download(firstFile, outsider, 403);
    await download(firstFile, null, 401);

    project.freelancer = selected.user._id;
    await project.save();
    await Application.updateOne({ _id: second._id }, { $set: { status: "ACCEPTED" } });
    // Hiring does not reveal the unsuccessful applicant's files or reopen their conversation.
    await download(firstFile, selected, 403);
    await download(clientFile, selected, 403);
    await download(firstFile, applicant, 403);
    await download(firstFile, client, 403);
    await download(secondFile, selected, 200, "Selected applicant's approach");
    await download(secondFile, client, 200, "Selected applicant's approach");

    const bytes = Buffer.from("Legacy milestone evidence");
    const [evidence] = await saveAttachments(project, selected.user, [{ originalname: "delivery.txt", mimetype: "text/plain", size: bytes.length, buffer: bytes }]);
    // Unassociated files are not a public project bucket, even to participants.
    await download(evidence._id, selected, 404);
    await download(evidence._id, client, 404);
    project.milestones.push({ title: "Delivered", submissions: [{ author: selected.user._id, files: [evidence._id] }] });
    await project.save();
    await download(evidence._id, selected, 200, bytes.toString());
    await download(evidence._id, client, 200, bytes.toString());
    await download(evidence._id, applicant, 403);
    await download(evidence._id, outsider, 403);
    const [caseEvidence] = await saveAttachments(project, selected.user, [{ originalname: "case.txt", mimetype: "text/plain", size: bytes.length, buffer: bytes }]);
    await require("./models/Dispute").create({ project: project._id, history: [{ author: selected.user._id, action: "opened", text: "Private case evidence", attachments: [caseEvidence._id] }] });
    await download(caseEvidence._id, selected, 200, bytes.toString());
    await download(caseEvidence._id, client, 200, bytes.toString());
    await download(caseEvidence._id, applicant, 403);
    await download(caseEvidence._id, outsider, 403);
    const otherProject = await Project.create({ client: client.user._id, title: "Different project", budget: 100, deadline: "2035-12-31" });
    await download(evidence._id, client, 404, null, otherProject._id);
    await download(evidence._id, outsider, 403, null, otherProject._id);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
