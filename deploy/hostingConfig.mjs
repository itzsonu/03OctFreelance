export function createHostingConfig(env, routes, deploymentEnv) {
  let backend;
  try { backend = new URL(env.FREELANCECHAIN_BACKEND_ORIGIN); } catch { throw new Error("Set FREELANCECHAIN_BACKEND_ORIGIN to the new FreelanceChain HTTPS backend origin."); }
  if (backend.protocol !== "https:" || backend.origin !== env.FREELANCECHAIN_BACKEND_ORIGIN || backend.username || backend.password) throw new Error("Backend must be an exact HTTPS origin without credentials, path or trailing slash.");
  if (!env.FC_PROXY_SECRET || env.FC_PROXY_SECRET.length < 32 || env.FC_PROXY_SECRET.length > 256) throw new Error("Set the same private FC_PROXY_SECRET in Vercel and the new backend (32–256 characters).");
  if (env.REACT_APP_API_URL && env.REACT_APP_API_URL !== "/api") throw new Error("Leave REACT_APP_API_URL unset or use /api. Direct cross-site API cookies are unsupported.");
  return {
    framework: "create-react-app",
    installCommand: "npm ci",
    buildCommand: "npm run build",
    outputDirectory: "build",
    rewrites: [
      routes.rewrite("/api/:path*", backend.origin + "/api/:path*", { requestHeaders: { "x-fc-origin-secret": deploymentEnv("FC_PROXY_SECRET") } }),
      routes.rewrite("/((?!api(?:/|$)).*)", "/index.html"),
    ],
    headers: [
      { source: "/api/:path*", headers: [
        { key: "Cache-Control", value: "private, no-store" },
        { key: "CDN-Cache-Control", value: "no-store" },
        { key: "Vercel-CDN-Cache-Control", value: "no-store" },
        { key: "x-vercel-enable-rewrite-caching", value: "0" },
      ] },
      { source: "/(.*)", headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" },
      ] },
    ],
  };
}
