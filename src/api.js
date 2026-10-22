const API_BASE = (process.env.REACT_APP_API_URL || (process.env.NODE_ENV === "production" ? "/api" : "http://localhost:5000/api")).replace(/\/$/, "");

function expireSession(token) {
  if (!token || localStorage.getItem("token") !== token) return;
  signOut();
  window.dispatchEvent(new Event("freelancechain:session-expired"));
}

export function currentUser() {
  try {
    return JSON.parse(localStorage.getItem("user"));
  } catch {
    return null;
  }
}

export async function api(path, options = {}) {
  const token = localStorage.getItem("token");
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    if (response.status === 401 && token && localStorage.getItem("token") === token) {
      expireSession(token);
      throw new Error("Session expired. Please log in again.");
    }
    throw new Error(data.message || `Request failed (${response.status})`);
  }
  return data;
}

export async function downloadAttachment(projectId, attachment) {
  const token = localStorage.getItem("token");
  const response = await fetch(`${API_BASE}/workrooms/projects/${projectId}/files/${attachment.id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });
  if (!response.ok) {
    let data = {};
    try { data = await response.json(); } catch { /* retain the status fallback */ }
    if (response.status === 401 && token) expireSession(token);
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
  const token = localStorage.getItem("token");
  const response = await fetch(`${API_BASE}/admin/cases/${caseId}/files/${attachment.id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });
  if (!response.ok) {
    let data = {};
    try { data = await response.json(); } catch { /* retain the status fallback */ }
    if (response.status === 401 && token) expireSession(token);
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
    const token = localStorage.getItem("token");
    if (stopped || !token) return;
    controller = new AbortController();
    try {
      const response = await fetch(`${API_BASE}/updates`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401) {
        expireSession(token);
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

export function signOut() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}
