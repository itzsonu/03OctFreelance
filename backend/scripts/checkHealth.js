async function checkHealth(origin, fetcher = fetch) {
  const url = new URL("/api/health/ready", origin);
  const response = await fetcher(url, { signal: AbortSignal.timeout(4000), redirect: "error" });
  if (!response.ok || (await response.json()).status !== "ready") throw new Error("Service is not ready");
  return true;
}
if (require.main === module) checkHealth(process.argv[2] || process.env.APP_ORIGIN || "http://localhost:5000").then(() => console.log("Service ready")).catch(() => { console.error("Service not ready"); process.exitCode = 1; });
module.exports = { checkHealth };
