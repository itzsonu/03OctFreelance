export function createHostingConfig(env, routes, deploymentEnv) {
  let backend;
  try { backend = new URL(env.FREELANCECHAIN_BACKEND_ORIGIN); } catch { throw new Error("Set FREELANCECHAIN_BACKEND_ORIGIN to the new FreelanceChain HTTPS backend origin."); }
  if (backend.protocol !== "https:" || backend.origin !== env.FREELANCECHAIN_BACKEND_ORIGIN || backend.username || backend.password) throw new Error("Backend must be an exact HTTPS origin without credentials, path or trailing slash.");
  if (!env.FC_PROXY_SECRET || env.FC_PROXY_SECRET.length < 32 || env.FC_PROXY_SECRET.length > 256) throw new Error("Set the same private FC_PROXY_SECRET in Vercel and the new backend (32–256 characters).");
  if (env.REACT_APP_API_URL && env.REACT_APP_API_URL !== "/api") throw new Error("Leave REACT_APP_API_URL unset or use /api. Direct cross-site API cookies are unsupported.");
  const apiRoute = routes.rewrite("/api/:path*", backend.origin + "/api/:path*", {
    requestHeaders: { "x-fc-origin-secret": deploymentEnv("FC_PROXY_SECRET") },
    respectOriginCacheControl: false,
  });
  return {
    framework: "create-react-app",
    installCommand: "npm ci",
    buildCommand: "npm run build",
    outputDirectory: "build",
    // Header transforms require every routing rule to use the lower-level format.
    routes: [
      { src: "^/(.*)$", headers: {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer", "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Content-Security-Policy": "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: blob:; connect-src 'self' https://accounts.google.com/gsi/; frame-src https://accounts.google.com/gsi/; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
      }, continue: true },
      // Only the public Google login page shares its origin; private pages retain no-referrer.
      { src: "^/login/?$", headers: { "Referrer-Policy": "strict-origin" }, continue: true },
      { ...apiRoute, headers: {
        "Cache-Control": "private, no-store",
        "CDN-Cache-Control": "no-store",
        "Vercel-CDN-Cache-Control": "no-store",
        "x-vercel-enable-rewrite-caching": "0",
      } },
      { handle: "filesystem" },
      { src: "^/((?!api(?:/|$)).*)$", dest: "/index.html" },
    ],
  };
}
