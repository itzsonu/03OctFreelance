// Test-only HTTP credentials. Production login never returns the session secret.
const { createSession, cookieName } = require("./sessions");
async function testSession(user) {
  const result = await createSession(user);
  return { cookie: `${cookieName()}=${result.token}`, csrfToken: result.csrfToken };
}
function authHeaders(auth) {
  return { "X-FreelanceChain-Request": "1", ...(auth ? { Cookie: auth.cookie, "X-CSRF-Token": auth.csrfToken } : {}) };
}
function responseAuth(response, data) {
  const value = response.headers.get("set-cookie");
  return value && data.csrfToken ? { cookie: value.split(";")[0], csrfToken: data.csrfToken } : null;
}
module.exports = { testSession, authHeaders, responseAuth };
