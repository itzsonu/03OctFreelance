import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import "./GoogleSignIn.css";
let sdkPromise;
let challengeQueue = Promise.resolve();
function requestChallenge(role, mode) {
  // Keep nonce-cookie responses ordered when the account type changes mid-request.
  const request = challengeQueue.catch(() => {}).then(() => api("/auth/google/challenge", { method: "POST", body: JSON.stringify({ role, mode }) }));
  challengeQueue = request;
  return request;
}
export function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (!sdkPromise) sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client"; script.async = true; script.referrerPolicy = "strict-origin-when-cross-origin";
    const timer = setTimeout(() => { script.remove(); reject(new Error("Google sign-in could not load. Use email and password or try again.")); }, 12000);
    script.onload = () => { clearTimeout(timer); if (window.google?.accounts?.id) resolve(window.google.accounts.id); else reject(new Error("Google sign-in could not load.")); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error("Google sign-in could not load. Use email and password.")); };
    document.head.appendChild(script);
  }).catch(error => { sdkPromise = null; throw error; });
  return sdkPromise;
}
export default function GoogleSignIn({ role, mode, busy, onSuccess, onError, onBusy }) {
  const [status, setStatus] = useState(null), [statusError, setStatusError] = useState(false), [loading, setLoading] = useState(false), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const host = useRef(null), submitting = useRef(false), handlers = useRef({});
  const tryAgain = () => { setStatus(null); setStatusError(false); setRetry(value => value + 1); };
  handlers.current = { onSuccess, onError, onBusy, busy };
  useEffect(() => {
    let active = true;
    setStatusError(false);
    api("/auth/google/status").then(data => { if (active) setStatus(data); }).catch(() => { if (active) setStatusError(true); });
    return () => { active = false; };
  }, [retry]);
  useEffect(() => {
    if (!status?.available || !host.current) return undefined;
    let active = true; setLoading(true); setFailed(false); host.current.replaceChildren();
    (async () => {
      // Load the public SDK and the role-bound nonce concurrently; neither depends on the other.
      const [google, challenge] = await Promise.all([
        loadGoogleIdentity(),
        requestChallenge(role, mode),
      ]);
      if (!active) return;
      google.initialize({ client_id: challenge.clientId, nonce: challenge.nonce, auto_select: false, context: mode === "register" ? "signup" : "signin", callback: async response => {
        if (!active || submitting.current || handlers.current.busy) return;
        submitting.current = true; handlers.current.onBusy?.(true);
        try {
          if (!response?.credential) throw new Error("Google sign-in did not finish. Try again.");
          const result = await api("/auth/google", { method: "POST", body: JSON.stringify({ credential: response.credential, role, mode }) });
          if (active) handlers.current.onSuccess(result);
        } catch (error) { if (active) { setFailed(true); handlers.current.onError(error.message); } }
        finally { submitting.current = false; handlers.current.onBusy?.(false); }
      } });
      google.renderButton(host.current, { type: "standard", theme: "outline", size: "large", text: mode === "register" ? "signup_with" : "signin_with", width: Math.min(360, host.current.clientWidth || 320) });
      setLoading(false);
    })().catch(error => { if (active) { setLoading(false); setFailed(true); handlers.current.onError(error.message); } });
    return () => { active = false; };
  }, [status, role, mode, retry]);
  if (status && !status.available) return null;
  if (!status || statusError) return <div className="google-signin"><div className="google-divider"><span>or</span></div><p role="status">{statusError ? "Google sign-in could not connect. Email sign-in is available below." : "Preparing Google sign-in… Email sign-in is ready below."}</p>{statusError && <button className="text-button" type="button" disabled={busy} onClick={tryAgain}>Try Google again</button>}</div>;
  return <div className="google-signin"><div className="google-divider"><span>or</span></div>{loading && <p role="status">Loading Google sign-in…</p>}<div ref={host} aria-label="Google sign-in" className={busy || failed ? "google-button-blocked" : ""} />{failed && <button className="text-button" type="button" disabled={busy} onClick={tryAgain}>Try Google again</button>}</div>;
}
