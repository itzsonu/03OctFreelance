import { useEffect, useState } from "react";
import { currentUser, restoreSession } from "./api";

// Public pages also need to recognize an existing HttpOnly-cookie session.
export default function useSessionIdentity() {
  const [user, setUser] = useState(currentUser);
  const [checking, setChecking] = useState(!currentUser());
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setChecking(true); setError("");
    restoreSession().then(identity => { if (active) setUser(identity || null); })
      .catch(err => { if (active) setError(err.message); })
      .finally(() => { if (active) setChecking(false); });
    const expired = () => { if (active) { setUser(null); setChecking(false); } };
    window.addEventListener("freelancechain:session-expired", expired);
    return () => { active = false; window.removeEventListener("freelancechain:session-expired", expired); };
  }, [attempt]);
  return { user, checking, error, retry: () => setAttempt(value => value + 1) };
}
