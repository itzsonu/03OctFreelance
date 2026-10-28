const express = require("express");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { protect } = require("./middleware/authMiddleware");
const { subscribe } = require("./liveUpdates");
const { requestSecurity, securityHeaders } = require("./requestSecurity");
const { limitIp } = require("./abuseProtection");

const app = express();
app.disable("x-powered-by");
// Only explicitly configured proxy addresses/subnets may supply a forwarded client IP.
if (process.env.TRUST_PROXY) {
  if (/^(true|\d+)$/i.test(process.env.TRUST_PROXY.trim())) throw new Error("TRUST_PROXY must list trusted proxy IP addresses or subnets, not a hop count or true");
  app.set("trust proxy", process.env.TRUST_PROXY.split(",").map(value => value.trim()).filter(Boolean));
}
app.use("/api", require("./observability").middleware);
app.use(securityHeaders);
app.use("/api", require("./cloudProxy").cloudProxy);
app.use("/api", requestSecurity);
app.use(express.json({ limit: "100kb" }));
app.use("/api", limitIp);

app.locals.draining = false;
app.get("/api/health/live", (req, res) => res.status(app.locals.draining ? 503 : 200).json({ status: app.locals.draining ? "draining" : "alive" }));
app.get("/api/health/ready", async (req, res) => {
  try {
    if (app.locals.draining || mongoose.connection.readyState !== 1) throw new Error("not_ready");
    await mongoose.connection.db.command({ ping: 1 }, { maxTimeMS: 2000 });
    await require("./deployment").checkPrivateStorage();
    res.json({ status: "ready" });
  } catch { res.status(503).json({ status: "not_ready" }); }
});
app.use("/api", (req, res, next) => app.locals.draining ? res.status(503).json({ message: "Service is restarting. Please retry shortly." }) : next());

app.get("/api/health", (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({ status: connected ? "ok" : "database_unavailable" });
});

app.get("/api/updates", protect, subscribe);

app.use("/api/account", require("./routes/accountRoutes"));
app.use("/api/account/email-verification", require("./routes/emailVerificationRoutes"));
app.use("/api/account", require("./routes/supportRoutes").accountRouter);
app.use("/api/support", require("./routes/supportRoutes").publicRouter);
app.use("/api/project-drafts", require("./routes/projectDraftRoutes"));
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/auth/google", require("./routes/googleAuthRoutes"));
app.use("/api/profile", require("./routes/profileRoutes"));
app.use("/api/talent", require("./routes/talentRoutes"));
app.use("/api/invitations", require("./routes/invitationRoutes"));
app.use("/api/messages", require("./routes/messageRoutes"));
app.use("/api/workrooms", require("./routes/workroomRoutes"));
app.use("/api/task-boards", require("./routes/taskBoardRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/reviews", require("./routes/reviewRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/api/projects", require("./routes/projectRoutes"));
app.use("/api/applications", require("./routes/applicationRoutes"));
app.use("/api", (req, res) => res.status(404).json({ message: "API route not found" }));

const buildPath = path.resolve(__dirname, "../build");
if (fs.existsSync(path.join(buildPath, "index.html"))) {
  app.use(express.static(buildPath));
  app.use((req, res, next) => {
    if (req.method === "GET" && req.accepts("html")) {
      return res.sendFile(path.join(buildPath, "index.html"));
    }
    next();
  });
}

module.exports = app;
