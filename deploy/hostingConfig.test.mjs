import test from "node:test";
import assert from "node:assert/strict";
import { routes, deploymentEnv } from "@vercel/config/v1";
import { createHostingConfig } from "./hostingConfig.mjs";

test("cloud config forwards API routes privately and refuses invalid cookie setup", () => {
  const env = { FREELANCECHAIN_BACKEND_ORIGIN: "https://fc-api.example.test", FC_PROXY_SECRET: "test-origin-secret-" + "x".repeat(40) };
  const config = createHostingConfig(env, routes, deploymentEnv);
  assert.equal(config.outputDirectory, "build");
  const serialized = JSON.stringify(config);
  assert.equal(serialized.includes(env.FC_PROXY_SECRET), false);
  assert.equal(serialized.includes("FC_PROXY_SECRET"), true);
  assert.match(serialized, /x-fc-origin-secret/); assert.match(serialized, /fc-api.example.test/); assert.match(serialized, /no-store/);
  assert.equal(config.rewrites.length, 2); assert.match(JSON.stringify(config.rewrites[1]), /index.html/);
  for (const bad of ["http://fc.example.test", "https://fc.example.test/", "https://fc.example.test/api", "https://user:pass@fc.example.test", "not-a-url"]) assert.throws(() => createHostingConfig({ ...env, FREELANCECHAIN_BACKEND_ORIGIN: bad }, routes, deploymentEnv));
  assert.throws(() => createHostingConfig({ ...env, FC_PROXY_SECRET: "short" }, routes, deploymentEnv));
  assert.throws(() => createHostingConfig({ ...env, REACT_APP_API_URL: "https://fc-api.example.test/api" }, routes, deploymentEnv));
});
