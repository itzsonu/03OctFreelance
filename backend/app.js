const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { protect } = require("./middleware/authMiddleware");
const { subscribe } = require("./liveUpdates");

const app = express();
app.use((req, res, next) => { res.set("Referrer-Policy", "no-referrer"); next(); });
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:3000,http://127.0.0.1:3000")
  .split(",").map(origin => origin.trim()).filter(Boolean);

app.use((req, res, next) => {
  const origin = req.get("origin");
  if (!origin) return next();
  let sameHost = false;
  try { sameHost = new URL(origin).host === req.get("host"); } catch { /* invalid origin */ }
  if (sameHost) return next();
  if (!allowedOrigins.includes(origin)) return res.status(403).json({ message: "Origin not allowed" });
  return cors({ origin })(req, res, next);
});
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({ status: connected ? "ok" : "database_unavailable" });
});

app.get("/api/updates", protect, subscribe);

app.use("/api/account", require("./routes/accountRoutes"));
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/profile", require("./routes/profileRoutes"));
app.use("/api/talent", require("./routes/talentRoutes"));
app.use("/api/invitations", require("./routes/invitationRoutes"));
app.use("/api/messages", require("./routes/messageRoutes"));
app.use("/api/workrooms", require("./routes/workroomRoutes"));
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
