// Cache public JavaScript modules only; never preload API data or bypass a route guard.
export function createPageLoader(importers) {
  const pending = new Map();
  return name => {
    if (!importers[name]) return Promise.reject(new Error("Unknown page"));
    if (!pending.has(name)) pending.set(name, Promise.resolve().then(importers[name]).catch(error => { pending.delete(name); throw error; }));
    return pending.get(name);
  };
}

export const loadPage = createPageLoader({
  Support: () => import("./pages/Support"),
  ServicePolicies: () => import("./pages/ServicePolicies"),
  AdminSupport: () => import("./pages/AdminSupport"),
  AdminStorage: () => import("./pages/AdminStorage"),
  AccountSettings: () => import("./pages/AccountSettings"),
  VerifyEmailChange: () => import("./pages/VerifyEmailChange"),
  ForgotPassword: () => import("./pages/ForgotPassword"),
  ResetPassword: () => import("./pages/ResetPassword"),
  ClientDashboard: () => import("./pages/ClientDashboard"),
  FreelancerDashboard: () => import("./pages/FreelancerDashboard"),
  TaskBoard: () => import("./pages/TaskBoard"),
  MyTasks: () => import("./pages/MyTasks"),
  MilestoneChain: () => import("./pages/MilestoneChain"),
  WorkroomInbox: () => import("./pages/WorkroomInbox"),
  FreelancerProfile: () => import("./pages/FreelancerProfile"),
  TalentDirectory: () => import("./pages/TalentDirectory"),
  PublicJob: () => import("./pages/PublicJob"),
  TalentProfile: () => import("./pages/TalentProfile"),
  AdminCases: () => import("./pages/AdminCases"),
  AdminDashboard: () => import("./pages/AdminDashboard"),
});

const routes = {
  "/support": "Support", "/account": "AccountSettings", "/workrooms": "WorkroomInbox",
  "/client-dashboard": "ClientDashboard", "/freelancer-dashboard": "FreelancerDashboard",
  "/profile": "FreelancerProfile", "/my-tasks": "MyTasks", "/task-boards": "TaskBoard",
  "/talent": "TalentDirectory", "/admin/overview": "AdminDashboard", "/admin/cases": "AdminCases",
  "/admin/support": "AdminSupport", "/admin/storage": "AdminStorage",
};
export function pageForPath(path) {
  return routes[path] || (path.startsWith("/task-boards/") ? "TaskBoard" : path.startsWith("/milestones/") ? "MilestoneChain" : path.startsWith("/talent/") ? "TalentProfile" : path.startsWith("/jobs/") ? "PublicJob" : null);
}
export function warmLink(href, browser = window, load = loadPage) {
  if (!href || href.startsWith("#") || browser.navigator.onLine === false) return;
  try {
    const url = new URL(href, browser.location.href);
    if (url.origin !== browser.location.origin) return;
    const name = pageForPath(url.pathname);
    if (name) load(name).catch(() => {});
  } catch { /* A failed speculative download must not affect navigation. */ }
}
export function startPageWarmup(role, currentPath, { browser = window, page = document, load = loadPage } = {}) {
  const connection = browser.navigator.connection;
  if (browser.navigator.onLine === false || connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType) || page.visibilityState === "hidden") return () => {};
  const byRole = {
    client: ["WorkroomInbox", "AccountSettings", "TalentDirectory", "MilestoneChain"],
    freelancer: ["WorkroomInbox", "TaskBoard", "MyTasks", "AccountSettings", "FreelancerProfile", "MilestoneChain"],
    admin: ["AdminCases", "AdminSupport", "AdminStorage", "AccountSettings"],
  };
  let stopped = false;
  async function warm() {
    for (const name of byRole[role] || []) {
      if (stopped || page.visibilityState === "hidden" || browser.navigator.onLine === false) return;
      if (name === pageForPath(currentPath)) continue;
      try { await load(name); } catch { /* Retry on navigation intent if the network recovers. */ }
    }
  }
  // Give the current page a head start; download one module at a time when idle.
  let idle;
  const timer = browser.setTimeout(() => {
    if (stopped) return;
    if (browser.requestIdleCallback) idle = browser.requestIdleCallback(warm, { timeout: 5000 });
    else warm();
  }, 2000);
  return () => { stopped = true; browser.clearTimeout(timer); if (idle !== undefined) browser.cancelIdleCallback?.(idle); };
}
