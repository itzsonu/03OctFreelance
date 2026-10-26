import React, { useEffect, useState } from "react";
import { warmService } from "../api";
import { startServiceActivity } from "../serviceActivity";
import { watchServiceConnection } from "../serviceRecovery";
import "./ServiceConnectionNotice.css";
export default function ServiceConnectionNotice() {
  const [state, setState] = useState("idle");
  useEffect(() => watchServiceConnection(setState), []);
  useEffect(() => startServiceActivity(warmService), []);
  if (state === "idle") return null;
  return <aside className="service-connection-notice" role="status" aria-live="polite"><strong>{state === "connecting" ? "Starting your workspace…" : "Connection is taking longer than expected"}</strong><p>{state === "connecting" ? "The service is waking up. We’ll reconnect automatically for up to two minutes. Keep this page open." : "Your page is still here. Reconnect, then retry the interrupted view. Check whether any submitted change was saved before sending it again."}</p>{state === "unavailable" && <button type="button" className="button button-outline" onClick={() => { warmService().catch(() => {}); }}>Reconnect</button>}</aside>;
}
