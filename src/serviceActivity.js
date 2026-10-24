export const ACTIVE_SERVICE_CHECK_MS = 4 * 60 * 1000;

// Only a visible, online page generates health traffic; never replay user actions.
export function startServiceActivity(warm, { page = document, browser = window } = {}) {
  let stopped = false;
  let pending = false;
  async function check() {
    if (stopped || pending || page.visibilityState === "hidden" || browser.navigator.onLine === false) return;
    pending = true;
    try { await warm(); } catch { /* Shared recovery already reports connection status. */ }
    finally { pending = false; }
  }
  const visible = () => { if (page.visibilityState !== "hidden") check(); };
  page.addEventListener("visibilitychange", visible);
  browser.addEventListener("online", check);
  const timer = browser.setInterval(check, ACTIVE_SERVICE_CHECK_MS);
  check();
  return () => {
    stopped = true;
    browser.clearInterval(timer);
    page.removeEventListener("visibilitychange", visible);
    browser.removeEventListener("online", check);
  };
}
