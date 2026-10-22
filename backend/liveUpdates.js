const connections = new Set();

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
  const client = { userId, role: req.user.role, res };
  connections.add(client);
  res.write("event: ready\ndata: {}\n\n");
  const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 25000);
  const lifetime = setTimeout(() => res.end(), 30 * 60 * 1000);
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

module.exports = { disconnectUser, subscribe, publishUser, publishProject, publishMarketplace };
