const connections = new Set();
const crypto = require("node:crypto");
const { sessionActive } = require("./sessions");

function identity(value) {
  if (!value) return null;
  return String(value._id || value);
}

function subscribe(req, res) {
  const userId = identity(req.user);
  if ([...connections].filter(client => client.userId === userId).length >= 5) {
    return res.status(429).json({ message: "Too many live update connections" });
  }
  res.status(200);
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  const client = { userId, role: req.user.role, sessionHash: req.authSession?.tokenHash, res };
  connections.add(client);
  res.write("event: ready\ndata: {}\n\n");
  let checking = false;
  const heartbeat = setInterval(async () => {
    if (checking) return;
    checking = true;
    try { if (!await sessionActive(req.authSession)) return res.end(); res.write(": keepalive\n\n"); }
    catch { res.end(); }
    finally { checking = false; }
  }, 25000);
  const remaining = req.authSession ? Math.max(1, req.authSession.expiresAt.getTime() - Date.now()) : 30 * 60 * 1000;
  const lifetime = setTimeout(() => res.end(), Math.min(30 * 60 * 1000, remaining));
  heartbeat.unref?.();
  lifetime.unref?.();
  res.on("close", () => {
    connections.delete(client);
    clearInterval(heartbeat);
    clearTimeout(lifetime);
  });
}

function send(client, type, projectId = null) {
  try {
    client.res.write(`event: ${type}\ndata: ${JSON.stringify({ projectId })}\n\n`);
  } catch {
    connections.delete(client);
  }
}

function publishUser(userId, type, projectId) {
  const target = identity(userId);
  if (!target) return;
  for (const client of connections) if (client.userId === target) send(client, type, identity(projectId));
}

function publishProject(project) {
  publishUser(project.client, "project", project._id);
  publishUser(project.freelancer, "project", project._id);
}

function publishMarketplace() {
  for (const client of connections) if (client.role === "freelancer") send(client, "marketplace");
}

function disconnectUser(userId) {
  const id = identity(userId);
  for (const client of connections) if (client.userId === id) { connections.delete(client); client.res.end(); }
}

function disconnectSession(token) {
  if (!token) return;
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  for (const client of connections) if (client.sessionHash === hash) { connections.delete(client); client.res.end(); }
}

function disconnectAll() { for (const client of connections) client.res.end(); connections.clear(); }
module.exports = { disconnectAll, disconnectSession, disconnectUser, subscribe, publishUser, publishProject, publishMarketplace };
