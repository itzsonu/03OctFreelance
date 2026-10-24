const listeners = new Set();
let connectionState = "idle";
let recovery = null;
const transient = response => [502, 503, 504].includes(response?.status);
const unavailable = () => new Error("The connection is taking longer than expected. Please try again shortly.");
function notify(state) { if (state === connectionState) return; connectionState = state; for (const listener of listeners) listener(state); }
export function watchServiceConnection(listener) { listeners.add(listener); listener(connectionState); return () => listeners.delete(listener); }
async function timedFetch(url, options, timeout = 12000) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}
export function ensureServiceReady(url) {
  if (recovery) return recovery;
  notify("connecting");
  const deadline = Date.now() + 75000;
  const request = (async () => {
    for (let attempt = 0; attempt < 6 && Date.now() < deadline; attempt++) {
      try {
        const response = await timedFetch(url, { cache: "no-store", credentials: "include" }, Math.min(12000, deadline - Date.now()));
        if (response.ok && (await response.json()).status === "ready") { notify("idle"); return; }
        if ([401, 403, 404].includes(response.status)) break;
      } catch { /* Cold starts and dropped proxy connections are temporary. */ }
      if (attempt < 5) await new Promise(resolve => setTimeout(resolve, Math.min(15000, 5000 * (attempt + 1), Math.max(0, deadline - Date.now()))));
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
  await ensureServiceReady(healthUrl);
  if (options.signal?.aborted || !isCurrent()) throw new Error("Your account changed. Please retry this view.");
  try { response = await timedFetch(url, options); } catch { notify("unavailable"); throw unavailable(); }
  if (transient(response)) { notify("unavailable"); throw unavailable(); }
  return response;
}
