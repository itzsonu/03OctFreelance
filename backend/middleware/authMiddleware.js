const { readSession, csrfValid, clearSessionCookie } = require("../sessions");
const { limitUser } = require("../abuseProtection");

const protect = async (req, res, next) => {
  try {
    if (req.authSession) return next();
    const auth = await readSession(req);
    if (!auth) {
      clearSessionCookie(res);
      return res.status(401).json({ message: "Session expired. Please log in again." });
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !csrfValid(req, auth.token)) return res.status(403).json({ code: "CSRF_INVALID", message: "Session protection changed. Refresh the page before trying again." });
    req.user = auth.user;
    req.authSession = auth.session;
    if (!await limitUser(req, res)) return;
    next();
  } catch (error) {
    return res.status(503).json({ message: "Session service is temporarily unavailable. Please try later." });
  }
};

const allowRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    next();
  };
};

module.exports = { protect, allowRoles };
