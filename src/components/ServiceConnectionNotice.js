import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { warmService } from "../api";
import { watchServiceConnection } from "../serviceRecovery";
import "./ServiceConnectionNotice.css";
export default function ServiceConnectionNotice() {
  const [state, setState] = useState("idle");
  const { pathname } = useLocation();
  useEffect(() => watchServiceConnection(setState), []);
  useEffect(() => { if (["/login", "/admin/login"].includes(pathname)) warmService().catch(() => {}); }, [pathname]);
  if (state === "idle") return null;
  return <aside className="service-connection-notice" role="status" aria-live="polite"><strong>{state === "connecting" ? "Starting your workspace…" : "Connection is taking longer than expected"}</strong><p>{state === "connecting" ? "This can take about a minute. We’ll continue automatically. Keep this page open." : "Your page is still here. Please try your action again shortly."}</p></aside>;
}
