const crypto = require("node:crypto");
const net = require("node:net");
function cloudProxy(req, res, next) {
  const expected = process.env.FC_PROXY_SECRET;
  if (!expected) return next();
  if (["GET", "HEAD"].includes(req.method) && ["/health/live", "/health/ready"].includes(req.path)) return next();
  const supplied = req.get("X-FC-Origin-Secret");
  if (typeof supplied !== "string" || supplied.length > 256 || !crypto.timingSafeEqual(crypto.createHash("sha256").update(supplied).digest(), crypto.createHash("sha256").update(expected).digest())) return res.status(403).json({ message: "Use the application's frontend address to access this API." });
  // Vercel overwrites X-Real-IP. Never use forwarded IPs on an unauthenticated origin request.
  const ip = req.get("X-Real-IP");
  if (typeof ip === "string" && net.isIP(ip)) req.rateLimitIp = ip;
  next();
}
module.exports = { cloudProxy };
