const test = require("node:test");
const assert = require("node:assert/strict");
const { resetDeliveryMode, resetDeliveryReady, sendResetEmail } = require("./resetMail");

const resetNames = ["APP_ORIGIN", "RESET_DELIVERY", "RESEND_API_KEY", "RESET_FROM_EMAIL", "GMAIL_USER", "GMAIL_APP_PASSWORD"];
const savedEnv = () => Object.fromEntries(resetNames.map(name => [name, process.env[name]]));
const restoreEnv = previous => {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
};

test("password reset delivery requires a safe configured origin", () => {
  const previous = savedEnv();
  try {
    process.env.APP_ORIGIN = "https://freelancechain.example";
    process.env.RESET_DELIVERY = "console";
    assert.equal(resetDeliveryReady(), false);
    assert.equal(resetDeliveryMode(), "unavailable");
    process.env.APP_ORIGIN = "http://127.0.0.1:5010";
    assert.equal(resetDeliveryReady(), true);
    assert.equal(resetDeliveryMode(), "local-console");
    delete process.env.RESET_DELIVERY;
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESET_FROM_EMAIL = "reset@example.test";
    process.env.APP_ORIGIN = "http://freelancechain.example";
    assert.equal(resetDeliveryReady(), false);
    process.env.APP_ORIGIN = "https://freelancechain.example";
    assert.equal(resetDeliveryReady(), true);
    assert.equal(resetDeliveryMode(), "email");
  } finally {
    restoreEnv(previous);
  }
});

test("Gmail uses a dedicated app password and sends the one-time link", async () => {
  const previous = savedEnv();
  try {
    process.env.APP_ORIGIN = "http://127.0.0.1:5010";
    process.env.RESET_DELIVERY = "gmail";
    process.env.GMAIL_USER = "sender@gmail.com";
    process.env.GMAIL_APP_PASSWORD = "abcd efgh ijkl mnop";
    assert.equal(resetDeliveryMode(), "email");
    let options;
    let message;
    let closed = false;
    await sendResetEmail("recipient@example.test", "x".repeat(43), { createTransport: config => {
      options = config;
      return { sendMail: async mail => { message = mail; }, close: () => { closed = true; } };
    } });
    assert.equal(options.service, "gmail");
    assert.deepEqual(options.auth, { user: "sender@gmail.com", pass: "abcdefghijklmnop" });
    assert.equal(message.to, "recipient@example.test");
    assert.match(message.text, /http:\/\/127\.0\.0\.1:5010\/reset-password\?token=/);
    assert.equal(closed, true);
    delete process.env.GMAIL_APP_PASSWORD;
    assert.equal(resetDeliveryMode(), "unavailable");
  } finally {
    restoreEnv(previous);
  }
});
