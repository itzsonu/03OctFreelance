const cors = require("cors");

function allowedOrigins() {
  const candidates = process.env.NODE_ENV === "production" ? [process.env.APP_ORIGIN, ...(process.env.CLIENT_ORIGIN || "").split(",")] : ["http://localhost:5000", "http://127.0.0.1:5000", "http://localhost:3000", "http://127.0.0.1:3000", process.env.APP_ORIGIN, ...(process.env.CLIENT_ORIGIN || "").split(",")];
  return [...new Set(candidates.filter(Boolean).map(value => value.trim()).filter(value => {
    try { const url = new URL(value); return url.origin === value && (url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.protocol === "http:")); } catch { return false; }
  }))];
}
function requestSecurity(req, res, next) {
  const origin = req.get("origin");
  const allowed = allowedOrigins();
  if (origin && !allowed.includes(origin)) return res.status(403).json({ message: "Origin not allowed" });
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("X-FreelanceChain-Request") !== "1") return res.status(403).json({ message: "A same-site application request is required", code: "REQUEST_HEADER_REQUIRED" });
  if (origin) return cors({ origin, credentials: true, allowedHeaders: ["Content-Type", "X-CSRF-Token", "X-FreelanceChain-Request"], methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] })(req, res, next);
  next();
}
function securityHeaders(req, res, next) {
  res.set({ "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Permissions-Policy": "camera=(), microphone=(), geolocation=()", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" });
  if (process.env.NODE_ENV === "production") res.set("Strict-Transport-Security", "max-age=31536000");
  if (req.path.startsWith("/api")) res.set("Cache-Control", "no-store");
  next();
}
module.exports = { allowedOrigins, requestSecurity, securityHeaders };
