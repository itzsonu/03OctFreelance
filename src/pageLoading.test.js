import { createPageLoader, startPageWarmup, warmLink } from "./pageLoading";

test("navigation and background warmup share one download and reuse the loaded module", async () => {
  let finish;
  const importer = jest.fn(() => new Promise(resolve => { finish = resolve; }));
  const load = createPageLoader({ Account: importer });
  const first = load("Account");
  expect(load("Account")).toBe(first);
  await Promise.resolve();
  finish({ default: "account module" });
  await expect(first).resolves.toEqual({ default: "account module" });
  await load("Account");
  expect(importer).toHaveBeenCalledTimes(1);
});

test("a failed speculative download can be retried by actual navigation", async () => {
  const importer = jest.fn().mockRejectedValueOnce(new Error("Network interrupted")).mockResolvedValue({ default: "recovered module" });
  const load = createPageLoader({ Account: importer });
  await expect(load("Account")).rejects.toThrow("Network interrupted");
  await expect(load("Account")).resolves.toEqual({ default: "recovered module" });
  expect(importer).toHaveBeenCalledTimes(2);
  await expect(load("unregistered page")).rejects.toThrow("Unknown page");
});

const fakeBrowser = navigator => ({ navigator, location: { href: "https://app.example/freelancer-dashboard", origin: "https://app.example" }, setTimeout: jest.fn(), clearTimeout: jest.fn() });

test.each([
  [{ onLine: false }, "visible"],
  [{ onLine: true, connection: { saveData: true } }, "visible"],
  [{ onLine: true, connection: { effectiveType: "2g" } }, "visible"],
  [{ onLine: true }, "hidden"],
])("background downloads are skipped for unavailable or constrained browsing (%j, %s)", (navigator, visibilityState) => {
  const browser = fakeBrowser(navigator), load = jest.fn();
  startPageWarmup("freelancer", "/account", { browser, page: { visibilityState }, load })();
  expect(browser.setTimeout).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
});

test("warmup downloads sequentially and stops scheduling pages when the workspace unmounts", async () => {
  const browser = fakeBrowser({ onLine: true });
  let finish;
  const load = jest.fn(() => new Promise(resolve => { finish = resolve; }));
  const stop = startPageWarmup("freelancer", "/account", { browser, page: { visibilityState: "visible" }, load });
  browser.setTimeout.mock.calls[0][0]();
  expect(load).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledWith("WorkroomInbox");
  stop(); finish({}); await Promise.resolve(); await Promise.resolve();
  expect(load).toHaveBeenCalledTimes(1);
});

test("link intent warms only registered same-origin page code", async () => {
  const browser = fakeBrowser({ onLine: true }), load = jest.fn().mockResolvedValue({});
  warmLink("/task-boards/project-123", browser, load);
  warmLink("https://external.example/task-boards", browser, load);
  warmLink("/api/account/export", browser, load);
  warmLink("#workspace-content", browser, load);
  expect(load).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledWith("TaskBoard");
});
