const CHANNEL = "freelancechain:session-change";
function openChannel() {
  try { return typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL) : null; }
  catch { return null; }
}
export function announceSessionChange() {
  const channel = openChannel();
  if (channel) { channel.postMessage("changed"); channel.close(); return; }
  // Only an event marker is stored, never account data or credentials.
  try { localStorage.setItem(CHANNEL, Date.now() + ":" + Math.random()); localStorage.removeItem(CHANNEL); }
  catch { /* Cross-tab updates are unavailable if both browser mechanisms are blocked. */ }
}
export function listenForSessionChanges(onChange) {
  const channel = openChannel();
  if (channel) {
    channel.onmessage = event => { if (event.data === "changed") onChange(); };
    return () => { channel.onmessage = null; channel.close(); };
  }
  const listener = event => { if (event.key === CHANNEL && event.newValue) onChange(); };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
