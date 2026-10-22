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
}

export function currentUser() { return sessionUser; }

export async function restoreSession() {
  if (ready) return sessionUser;
  if (restoring) return restoring;
  const version = generation;
  restoring = (async () => {
    const response = await fetch(`${API_BASE}/auth/session`, { credentials: "include", cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Unable to restore your session. Please try again.");
    if (generation === version) rememberSession(data);
    return sessionUser;
  })();
  try { return await restoring; } finally { restoring = null; }
}

export async function api(path, options = {}) {
  const loginAttempt = path === "/auth/login" ? ++loginSequence : loginSequence;
  const method = (options.method || "GET").toUpperCase();
  const write = !["GET", "HEAD", "OPTIONS"].includes(method);
  const publicAction = ["/auth/login", "/auth/register", "/auth/forgot-password", "/auth/reset-password", "/account/email/confirm", "/support", "/support/status"].includes(path);
  if (write && !publicAction && !csrfToken) await restoreSession();
  const requestGeneration = generation;
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...(write ? { "X-FreelanceChain-Request": "1", ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) } : {}),
      ...options.headers,
    },
  });
  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    if (response.status === 401 && sessionUser && generation === requestGeneration) {
      expireSession(requestGeneration);
      throw new Error("Session expired. Please log in again.");
    }
    if (response.status === 403 && data.code === "CSRF_INVALID" && generation === requestGeneration) { csrfToken = null; ready = false; }
    throw new Error(data.message || `Request failed (${response.status})`);
  }
  if (path === "/auth/login" && loginAttempt === loginSequence) rememberSession(data);
  if (data.signedOut && generation === requestGeneration) rememberSession({});
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

export function subscribeUpdates(onEvent) {
  let stopped = false;
  let controller;
  let retryTimer;
  let connectedBefore = false;

  async function connect() {
    if (stopped) return;
    let requestGeneration = generation;
    controller = new AbortController();
    try {
      if (!await restoreSession() || stopped) return;
      requestGeneration = generation;
      const response = await fetch(`${API_BASE}/updates`, {
        headers: { Accept: "text/event-stream" },
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401) {
        expireSession(requestGeneration);
        stopped = true;
        return;
      }
      if (!response.ok || !response.body?.getReader) throw new Error("Live updates unavailable");
      onEvent({ type: "connected" });
      if (connectedBefore) onEvent({ type: "reconnected" });
      connectedBefore = true;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const type = frame.split("\n").find(line => line.startsWith("event:"))?.slice(6).trim();
          const rawData = frame.split("\n").find(line => line.startsWith("data:"))?.slice(5).trim();
          if (!["project", "applications", "marketplace", "messages", "notifications"].includes(type) || !rawData) continue;
          try { onEvent({ type, ...JSON.parse(rawData) }); } catch { /* ignore an invalid event */ }
        }
        if (buffer.length > 16384) buffer = "";
      }
    } catch { /* a temporary disconnect retries below */ }
    if (!stopped) {
      onEvent({ type: "disconnected" });
      retryTimer = setTimeout(connect, 3000);
    }
  }

  connect();
  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    controller?.abort();
  };
}

export async function signOut({ localOnly = false } = {}) {
  if (!localOnly) await api("/auth/logout", { method: "POST" });
  rememberSession({});
}
