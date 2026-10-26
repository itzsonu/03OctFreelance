const listeners = new Set();
let connectionState = "idle";
let recovery = null;
let lastReadyUrl = null;
let readyUntil = 0;
const READY_REUSE_MS = 15000;
const transient = response => [502, 503, 504].includes(response?.status);
const unavailable = () => new Error("The connection is taking longer than expected. Please try again shortly.");
function notify(state) { if (state === "unavailable") readyUntil = 0; if (state === connectionState) return; connectionState = state; for (const listener of listeners) listener(state); }
export function watchServiceConnection(listener) { listeners.add(listener); listener(connectionState); return () => listeners.delete(listener); }
async function timedFetch(url, options, timeout = 12000, consume = response => response) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("Connection check timed out")); }, timeout);
  });
  try {
    // Keep the deadline active through the readiness JSON body, not just headers.
    return await Promise.race([(async () => consume(await fetch(url, { ...options, signal: controller.signal })))(), expired]);
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}

export function ensureServiceReady(url) {
  if (recovery) return recovery;
  if (url === lastReadyUrl && Date.now() < readyUntil) return Promise.resolve();
  notify("connecting");
  const deadline = Date.now() + 120000;
  const request = (async () => {
    for (let attempt = 0; attempt < 40 && Date.now() < deadline; attempt++) {
      try {
        const response = await timedFetch(url, { cache: "no-store", credentials: "include" }, Math.min(12000, deadline - Date.now()), async result => ({ status: result.status, ready: result.ok && (await result.json()).status === "ready" }));
        if (response.ready) { lastReadyUrl = url; readyUntil = Date.now() + READY_REUSE_MS; notify("idle"); return; }
        if ([401, 403, 404].includes(response.status)) break;
      } catch { /* Cold starts and dropped proxy connections are temporary. */ }
      if (attempt < 39 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, Math.min(3000, deadline - Date.now())));
    }
    notify("unavailable"); throw unavailable();
  })();
  recovery = request;
  request.then(() => { if (recovery === request) recovery = null; }, () => { if (recovery === request) recovery = null; });
  return request;
}
export async function waitForActiveRecovery() { if (recovery) await recovery; }
export async function fetchWithRecovery(url, options = {}, healthUrl, isCurrent = () => true) {
  const safeRead = ["GET", "HEAD"].includes((options.method || "GET").toUpperCase());
  if (!safeRead) return fetch(url, options); // Never replay a submitted action.
  let response;
  try { response = await timedFetch(url, options); }
  catch (error) { if (options.signal?.aborted) throw error; }
  if (response && !transient(response)) { if (response.ok) notify("idle"); return response; }
  // An actual request failure overrides the brief health reuse window.
  readyUntil = 0;
  await ensureServiceReady(healthUrl);
  if (options.signal?.aborted || !isCurrent()) throw new Error("Your account changed. Please retry this view.");
  try { response = await timedFetch(url, options); } catch { notify("unavailable"); throw unavailable(); }
  if (transient(response)) { notify("unavailable"); throw unavailable(); }
  return response;
}
