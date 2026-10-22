import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { currentUser, restoreSession } from "./api";

export default function ProtectedRoute({ children, allowedRole }) {
  const [expired, setExpired] = useState(false);
  const [checking, setChecking] = useState(!currentUser());
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setChecking(true); setError("");
    restoreSession().then(() => { if (active) setChecking(false); }).catch(err => { if (active) { setError(err.message); setChecking(false); } });
    return () => { active = false; };
  }, [attempt]);
  useEffect(() => {
    const onExpired = () => setExpired(true);
    window.addEventListener("freelancechain:session-expired", onExpired);
    return () => window.removeEventListener("freelancechain:session-expired", onExpired);
  }, []);
  const user = currentUser();
  const loginPath = allowedRole === "admin" ? "/admin/login" : "/login";

  if (checking) return <main className="empty-state" role="status">Restoring your session…</main>;
  if (error) return <main className="empty-state"><p role="alert">{error}</p><button className="button button-outline" onClick={() => setAttempt(value => value + 1)}>Retry sign-in check</button></main>;
  if (!user) {
    return <Navigate to={expired ? `${loginPath}?session=expired` : loginPath} replace />;
  }

  if (allowedRole && user.role !== allowedRole) {
    return <Navigate to="/" replace />;
  }

  return children;
}
