import test from "node:test";
import assert from "node:assert/strict";
import { routes, deploymentEnv } from "@vercel/config/v1";
import { getTransformedRoutes } from "@vercel/routing-utils";
import { createHostingConfig } from "./hostingConfig.mjs";

const env = { FREELANCECHAIN_BACKEND_ORIGIN: "https://fc-api.example.test", FC_PROXY_SECRET: "test-origin-secret-" + "x".repeat(40) };

test("cloud config compiles as one route format and forwards API requests privately", () => {
  const config = createHostingConfig(env, routes, deploymentEnv);
  assert.equal(config.outputDirectory, "build");
  assert.equal(config.rewrites, undefined);
  assert.equal(config.headers, undefined);
  assert.equal(getTransformedRoutes(config).error, null);
  const serialized = JSON.stringify(config);
  assert.equal(serialized.includes(env.FC_PROXY_SECRET), false);
  const api = config.routes.find(route => route.dest?.startsWith(env.FREELANCECHAIN_BACKEND_ORIGIN));
  const transform = api.transforms.find(rule => rule.target?.key === "x-fc-origin-secret");
  assert.equal(transform.op, "set");
  assert.deepEqual(transform.env, ["FC_PROXY_SECRET"]);
  assert.equal(api.headers["Cache-Control"], "private, no-store");
  assert.equal(api.headers["x-vercel-enable-rewrite-caching"], "0");
  assert.equal(api.respectOriginCacheControl, false);
  for (const path of ["/api", "/api/health/ready", "/api/projects/abc/tasks"]) {
    assert.match(path, new RegExp(api.src));
    assert.equal(path.replace(new RegExp(api.src), api.dest), env.FREELANCECHAIN_BACKEND_ORIGIN + (path === "/api" ? "/api/" : path));
  }
  const filesystem = config.routes.findIndex(route => route.handle === "filesystem");
  assert.ok(config.routes.indexOf(api) < filesystem);
  const spa = config.routes.at(-1);
  assert.ok(filesystem < config.routes.indexOf(spa));
  assert.equal(spa.dest, "/index.html");
  assert.match("/freelancer-dashboard", new RegExp(spa.src));
  assert.doesNotMatch("/api/missing", new RegExp(spa.src));
  assert.equal(config.routes[0].headers["X-Frame-Options"], "DENY");
  assert.equal(config.routes[0].continue, true);
  assert.equal(config.routes[0].headers["Referrer-Policy"], "no-referrer");
  const login = config.routes.find(r => r.headers?.["Referrer-Policy"] === "strict-origin");
  assert.match("/login", new RegExp(login.src));
  for (const privatePath of ["/account", "/reset-password", "/client-dashboard", "/api/auth/google", "/admin/login"]) assert.doesNotMatch(privatePath, new RegExp(login.src));
});

test("cloud config refuses insecure origins, missing secrets and cross-site cookie setup", () => {
  for (const bad of ["http://fc.example.test", "https://fc.example.test/", "https://fc.example.test/api", "https://user:pass@fc.example.test", "not-a-url"]) assert.throws(() => createHostingConfig({ ...env, FREELANCECHAIN_BACKEND_ORIGIN: bad }, routes, deploymentEnv));
  assert.throws(() => createHostingConfig({ ...env, FC_PROXY_SECRET: "short" }, routes, deploymentEnv));
  assert.throws(() => createHostingConfig({ ...env, REACT_APP_API_URL: "https://fc-api.example.test/api" }, routes, deploymentEnv));
});
