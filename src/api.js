import { announceSessionChange } from "./sessionChanges";
import { ensureServiceReady, fetchWithRecovery, waitForActiveRecovery } from "./serviceRecovery";
const API_BASE = (process.env.REACT_APP_API_URL || (process.env.NODE_ENV === "production" ? "/api" : "http://localhost:5000/api")).replace(/\/$/, "");

let sessionUser = null;
let csrfToken = null;
let ready = false;
let restoring = null;
let generation = 0;
let loginSequence = 0;
function removeLegacyCredentials() {
  try { localStorage.removeItem("token"); localStorage.removeItem("user"); } catch { /* Storage may be disabled. */ }
}
removeLegacyCredentials();
function rememberSession(data) {
  sessionUser = data.user || null;
  csrfToken = data.csrfToken || null;
  ready = true;
  generation++;
  removeLegacyCredentials();
}
function expireSession(requestGeneration) {
  if (requestGeneration !== generation) return;
  rememberSession({});
  window.dispatchEvent(new Event("freelancechain:session-expired"));
  announceSessionChange();
}

export function currentUser() { return sessionUser; }

export function warmService() { return ensureServiceReady(API_BASE + "/health/ready"); }

async function readResponse(response, write = false) {
  try {
    const data = await response.json();
    if (!data || typeof data !== "object") throw new Error("Invalid API data");
    return data;
  } catch {
    // Keep unauthorized responses in the normal session-expiry path, even if a proxy sends HTML.
    if (response.status === 401) return {};
    throw new Error([502, 503, 504].includes(response.status)
      ? (write ? "Connection interrupted. Check whether your change was saved before trying again." : "The connection is taking longer than expected. Please try again shortly.")
      : "The service returned an unreadable response. Please try again.");
  }
}
function checkSessionResponse(data, allowGuest = false) {
  const signedIn = data.user && ["client", "freelancer", "admin"].includes(data.user.role) && typeof data.csrfToken === "string" && data.csrfToken.length > 0;
  if (!signedIn && !(allowGuest && Object.hasOwn(data, "user") && data.user === null)) {
    throw new Error("Your sign-in status could not be confirmed. Please try again.");
  }
}
export function invalidateCachedSession() {
  sessionUser = null; csrfToken = null; ready = false; restoring = null;
  generation++; loginSequence++;
}

export async function restoreSession() {
  if (ready) return sessionUser;
  if (restoring) return restoring;
  const version = generation;
  const request = (async () => {
    const response = await fetchWithRecovery(`${API_BASE}/auth/session`, { credentials: "include", cache: "no-store" }, API_BASE + "/health/ready", () => generation === version);
    const data = await readResponse(response);
    if (!response.ok) throw new Error(data.message || "Unable to restore your session. Please try again.");
    checkSessionResponse(data, true);
    if (generation === version) rememberSession(data);
    return sessionUser;
  })();
  restoring = request;
  try { return await request; } finally { if (restoring === request) restoring = null; }
}

export async function api(path, options = {}) {
  const loginAction = ["/auth/login", "/auth/google"].includes(path);
  const loginAttempt = loginAction ? ++loginSequence : loginSequence;
  const method = (options.method || "GET").toUpperCase();
  const write = !["GET", "HEAD", "OPTIONS"].includes(method);
  const publicAction = ["/auth/login", "/auth/google", "/auth/google/challenge", "/account/email-verification/confirm", "/auth/register", "/auth/forgot-password", "/auth/reset-password", "/account/email/confirm", "/support", "/support/status"].includes(path);
  const beforeRecovery = generation;
  if (write) {
    if (["/auth/login", "/auth/register", "/auth/google", "/auth/google/challenge"].includes(path)) await warmService();
    await waitForActiveRecovery();
    if (generation !== beforeRecovery || loginAttempt !== loginSequence) throw new Error("Your account changed. Review this action and try again.");
  }
  if (write && !publicAction && !csrfToken) await restoreSession();
  const requestGeneration = generation;
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetchWithRecovery(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...(write ? { "X-FreelanceChain-Request": "1", ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) } : {}),
      ...options.headers,
    },
  }, API_BASE + "/health/ready", () => generation === requestGeneration);
  const data = await readResponse(response, write);
  if (!response.ok) {
    if (response.status === 401 && sessionUser && generation === requestGeneration) {
      expireSession(requestGeneration);
      throw new Error("Session expired. Please log in again.");
    }
    if (response.status === 403 && data.code === "CSRF_INVALID" && generation === requestGeneration) { csrfToken = null; ready = false; }
    throw new Error(data.message || `Request failed (${response.status})`);
  }
  if (loginAction) {
    checkSessionResponse(data);
    if (loginAttempt === loginSequence) { rememberSession(data); announceSessionChange(); }
  }
  if (data.signedOut && generation === requestGeneration) { rememberSession({}); announceSessionChange(); }
  return data;
}

export async function downloadAttachment(projectId, attachment) {
  const requestGeneration = generation;
  const response = await fetch(`${API_BASE}/workrooms/projects/${projectId}/files/${attachment.id}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    let data = {};
    try { data = await response.json(); } catch { /* retain the status fallback */ }
    if (response.status === 401 && sessionUser) expireSession(requestGeneration);
    throw new Error(data.message || `Download failed (${response.status})`);
  }
  const objectUrl = window.URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = attachment.filename || "attachment";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
}

export async function downloadCaseAttachment(caseId, attachment) {
  const requestGeneration = generation;
  const response = await fetch(`${API_BASE}/admin/cases/${caseId}/files/${attachment.id}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    let data = {};
    try { data = await response.json(); } catch { /* retain the status fallback */ }
    if (response.status === 401 && sessionUser) expireSession(requestGeneration);
    throw new Error(data.message || `Download failed (${response.status})`);
  }
  const objectUrl = window.URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = attachment.filename || "case-attachment";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
}

const updateListeners = new Set();
let stopSharedUpdates = null;
let sharedUpdateState = null;

export function subscribeUpdates(onEvent) {
  const listener = event => onEvent(event);
  updateListeners.add(listener);
  if (!stopSharedUpdates) {
    stopSharedUpdates = openUpdateStream(event => {
      if (["connected", "disconnected"].includes(event.type)) sharedUpdateState = event;
      for (const receive of [...updateListeners]) {
        if (!updateListeners.has(receive)) continue;
        try { receive(event); } catch { /* One view must not break the shared stream. */ }
      }
    });
  } else if (sharedUpdateState) listener(sharedUpdateState);
  return () => {
    updateListeners.delete(listener);
    if (!updateListeners.size) {
      stopSharedUpdates?.();
      stopSharedUpdates = null;
      sharedUpdateState = null;
    }
  };
}

function openUpdateStream(onEvent) {
  let stopped = false;
  let controller;
  let retryTimer;
  let idleTimer;
  let connectedBefore = false;
  let failures = 0;

  async function connect() {
    if (stopped) return;
    let requestGeneration = generation;
    controller = new AbortController();
    let reader;
    let receivedReady = false;
    const refreshIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => controller.abort(), 45000); };
    try {
      if (!await restoreSession() || stopped) return;
      requestGeneration = generation;
      refreshIdle();
      const response = await fetch(API_BASE + "/updates", {
        headers: { Accept: "text/event-stream" }, credentials: "include", cache: "no-store", signal: controller.signal,
      });
      if (stopped || requestGeneration !== generation) return;
      if (response.status === 401) {
        expireSession(requestGeneration);
        stopped = true;
        return;
      }
      if (!response.ok || !response.body?.getReader || !response.headers?.get("content-type")?.toLowerCase().startsWith("text/event-stream")) throw new Error("Live updates unavailable");
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!stopped) {
        const { done, value } = await reader.read();
        if (stopped || requestGeneration !== generation || done) break;
        refreshIdle();
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const type = frame.split("\n").find(line => line.startsWith("event:"))?.slice(6).trim();
          const rawData = frame.split("\n").find(line => line.startsWith("data:"))?.slice(5).trim();
          if (type === "ready" && !receivedReady) {
            receivedReady = true;
            const needsRefresh = connectedBefore || failures > 0;
            failures = 0;
            onEvent({ type: "connected" });
            if (needsRefresh) onEvent({ type: "reconnected" });
            connectedBefore = true;
            continue;
          }
          if (!receivedReady || !["project", "applications", "marketplace", "messages", "notifications", "tasks"].includes(type) || !rawData) continue;
          try { onEvent({ type, ...JSON.parse(rawData) }); } catch { /* Ignore an invalid event. */ }
        }
        if (buffer.length > 16384) buffer = "";
      }
    } catch { /* A temporary disconnect retries below. */ }
    finally { clearTimeout(idleTimer); controller.abort(); reader?.releaseLock?.(); }
    if (!stopped && requestGeneration === generation) {
      onEvent({ type: "disconnected" });
      const delay = Math.min(30000, 3000 * 2 ** Math.min(failures, 4));
      failures += 1;
      retryTimer = setTimeout(connect, delay);
    }
  }

  connect();
  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    clearTimeout(idleTimer);
    controller?.abort();
  };
}

export async function signOut({ localOnly = false } = {}) {
  if (!localOnly) await api("/auth/logout", { method: "POST" });
  rememberSession({});
  if (localOnly) announceSessionChange();
}
