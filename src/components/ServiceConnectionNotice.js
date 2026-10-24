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
  return <aside className="service-connection-notice" role="status" aria-live="polite"><strong>{state === "connecting" ? "Starting your workspace…" : "Connection is taking longer than expected"}</strong><p>{state === "connecting" ? "This can take about a minute. We’ll continue automatically. Keep this page open." : "Your page is still here. Please try your action again shortly."}</p></aside>;
}
