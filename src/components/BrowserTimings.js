import React, { useState } from "react";

const apiGroups = new Set(["auth", "account", "profile", "projects", "applications", "task-boards", "workrooms", "notifications", "admin", "health"]);
const milliseconds = value => Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
export function readBrowserTimings(timing, origin) {
  if (!timing?.getEntriesByType) return [];
  return timing.getEntriesByType("resource").flatMap(entry => {
    let url;
    try { url = new URL(entry.name); } catch { return []; }
    if (url.origin !== origin || url.pathname === "/api/updates") return [];
    const group = url.pathname.split("/")[2];
    const resource = url.pathname.startsWith("/api/") ? `${apiGroups.has(group) ? group : "other"} API`
      : /\.js$/.test(url.pathname) ? "JavaScript" : /\.css$/.test(url.pathname) ? "Stylesheet"
      : /\.(woff2?|ttf|otf)$/.test(url.pathname) ? "Font" : "Other asset";
    return [{ resource, totalMs: milliseconds(entry.duration), setupMs: entry.requestStart > 0 ? milliseconds(entry.requestStart - entry.startTime) : null,
      waitMs: entry.responseStart > 0 && entry.requestStart > 0 ? milliseconds(entry.responseStart - entry.requestStart) : null,
      downloadMs: entry.responseStart > 0 ? milliseconds(entry.responseEnd - entry.responseStart) : null,
      protocol: ["h2", "h3", "http/1.1"].includes(entry.nextHopProtocol) ? entry.nextHopProtocol : "unknown" }];
  }).filter(row => row.totalMs !== null).sort((a, b) => b.totalMs - a.totalMs).slice(0, 20);
}

export default function BrowserTimings() {
  const [rows, setRows] = useState(null);
  const refresh = () => setRows(readBrowserTimings(window.performance, window.location.origin));
  const ms = value => value == null ? "—" : `${value} ms`;
  return <section className="panel moderation-panel" aria-label="Connection timings">
    <div className="panel-heading"><h2>Connection timings</h2><button type="button" className="button button-outline" onClick={refresh}>Refresh connection timings</button></div>
    <p>Open a slow page, return here using the app links, then refresh these timings. The slowest completed requests in this tab appear first.</p>
    <p className="form-help">Connection/setup, response wait and download are measured by your browser. Response wait also includes network travel. Blank timings are unavailable. URLs, queries and account details are excluded; this report is not uploaded or saved.</p>
    {rows && (rows.length ? <div style={{ overflowX: "auto" }}><table style={{ width: "100%", textAlign: "left" }}><thead><tr><th>Resource</th><th>Total</th><th>Connection/setup</th><th>Response wait</th><th>Download</th><th>Protocol</th></tr></thead><tbody>{rows.map((row, index) => <tr key={index}><td>{row.resource}</td><td>{ms(row.totalMs)}</td><td>{ms(row.setupMs)}</td><td>{ms(row.waitMs)}</td><td>{ms(row.downloadMs)}</td><td>{row.protocol}</td></tr>)}</tbody></table></div> : <p>No completed same-site request timings are available in this tab.</p>)}
  </section>;
}
