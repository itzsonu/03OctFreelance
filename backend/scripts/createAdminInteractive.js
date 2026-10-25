// Owner-run local provisioning. No public route or production startup hook.
const { createAdmin } = require("./createAdmin");
const { createPrompt } = require("./adminConsolePrompt");
const prompt = createPrompt(process.stdin, process.stdout);
const ask = prompt.ask;
async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Open this setup from your own terminal.");
  const env = { ...process.env };
  if (!env.ADMIN_NAME || !env.ADMIN_EMAIL || !env.MONGO_URI) throw new Error("Set the target database, admin name and email before running this setup.");
  const target = new URL(env.MONGO_URI);
  console.log("Target database: " + target.hostname + target.pathname);
  console.log("New admin email: " + env.ADMIN_EMAIL);
  console.log("Existing accounts will never be promoted or overwritten.");
  if (env.FC_ADMIN_PROMPT_DB_PASSWORD === "1" || (target.username && !target.password && !env.MONGO_PASSWORD && !env.MONGO_PASSWORD_FILE)) {
    delete env.MONGO_PASSWORD_FILE;
    env.MONGO_PASSWORD = await ask("Current Atlas fc_app DATABASE password (hidden): ", true);
    if (!env.MONGO_PASSWORD) throw new Error("Database password cannot be empty.");
  }
  env.ADMIN_PASSWORD = await ask("Choose NEW admin password, 12-128 characters (hidden): ", true);
  if (env.ADMIN_PASSWORD.length < 12 || env.ADMIN_PASSWORD.length > 128) throw new Error("Choose an admin password of 12-128 characters.");
  const confirmation = await ask("Confirm NEW admin password (hidden): ", true);
  if (env.ADMIN_PASSWORD !== confirmation) throw new Error("Passwords did not match; nothing was created.");
  const approved = await prompt.confirmCreate();
  if (!approved) throw new Error("Cancelled; nothing was created.");
  try { await createAdmin(env); }
  finally { delete env.ADMIN_PASSWORD; delete env.MONGO_PASSWORD; }
  console.log("Ready. Use the email above and your chosen password at https://freelancechain-demo.vercel.app/admin/login");
}
main().catch(error => {
  const safe = /^(Open this|Set |Choose |Database password|Passwords did not|Cancelled|An account with this email|MONGO_|Configure only|Separate database|Use a valid|Use a URI|Database username)/.test(error.message);
  console.error(safe ? error.message : "Admin setup failed. Check the Atlas password and whether this computer's current IP is allowed in Atlas Network Access. No credentials were printed.");
  process.exitCode = 1;
}).finally(() => prompt.close());

