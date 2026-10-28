import { readBrowserTimings } from "./BrowserTimings";
const origin = "https://app.example";
test("slow requests separate setup, response wait and download without retaining private resource URLs", () => {
  const rows = readBrowserTimings({ getEntriesByType: () => [
    { name: `${origin}/api/account?private_token=never-print`, startTime: 10, requestStart: 4010, responseStart: 4310, responseEnd: 4410, duration: 4400, nextHopProtocol: "h2" },
    { name: `${origin}/static/js/private-filename.js`, startTime: 20, requestStart: 25, responseStart: 30, responseEnd: 1030, duration: 1010, nextHopProtocol: "h3" },
    { name: "https://external.example/track?email=private", duration: 9000 },
    { name: `${origin}/api/updates`, duration: 20000 },
  ] }, origin);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toEqual({ resource: "account API", totalMs: 4400, setupMs: 4000, waitMs: 300, downloadMs: 100, protocol: "h2" });
  expect(JSON.stringify(rows)).not.toMatch(/never-print|private|https|updates|external/);
});
test("unavailable and failed request phases are unknown rather than negative or falsely instantaneous", () => {
  expect(readBrowserTimings(null, origin)).toEqual([]);
  const [row] = readBrowserTimings({ getEntriesByType: () => [{ name: `${origin}/api/unregistered/secret-record-id`, duration: 5000, requestStart: 0, responseStart: 0 }] }, origin);
  expect(row).toEqual({ resource: "other API", totalMs: 5000, setupMs: null, waitMs: null, downloadMs: null, protocol: "unknown" });
});
