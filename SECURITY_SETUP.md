# Session and request protection

## Implemented behavior

The browser uses an opaque 256-bit random session cookie. JavaScript never receives the session secret, and old bearer JWTs are no longer accepted. MongoDB stores its SHA-256 hash, account version, absolute expiry and last request time. Public identity and the session-bound CSRF value are kept only in frontend memory; a reload restores them through `/api/auth/session`. Old `localStorage` credentials are removed.

The cookie is HttpOnly, SameSite=Lax and host-only, with Path=/. In production it is named `__Host-fc_session` and always has Secure. Sessions expire after 24 hours, or two hours without authenticated requests. Reads reject expired sessions immediately; MongoDB TTL cleanup is not the authentication check. Background API requests count as activity. Password changes, resets, confirmed email changes and global logout revoke sessions using the existing account version plus session cleanup. Ordinary logout deletes only that device's session. Login rotates an existing session cookie.

Authenticated writes require a session-bound `X-CSRF-Token`. Every API write, including login and public recovery requests, also requires `X-FreelanceChain-Request: 1`. Origins must match the explicit frontend allowlist. A failed CSRF check does not automatically replay a write. Credentialed CORS allows only configured origins. Private API responses use no-store. Responses also set a self-only script CSP, frame restrictions, nosniff, referrer policy and permissions policy; production adds HSTS.

Live streams close at absolute session expiry and reconnect at least every 30 minutes. Ordinary local logout immediately closes the matching stream. Every 25 seconds streams recheck stored session/account state, including revocations from another server. Cross-instance project-event distribution remains a separate deployment task.

## Deployment configuration

- Keep a private random `JWT_SECRET` of at least 32 characters. Its legacy environment name is retained; it now signs session-bound CSRF values.
- Set `NODE_ENV=production` and `APP_ORIGIN` to the exact HTTPS frontend origin with no path or trailing slash. Production startup rejects an invalid origin.
- Prefer serving the frontend and `/api` on one HTTPS origin. A same-site frontend/API arrangement can use exact `CLIENT_ORIGIN` entries and `REACT_APP_API_URL`. Unrelated cross-site domains are not supported by this SameSite=Lax design.
- Set `TRUST_PROXY` only to the actual proxy IP addresses/subnets and restrict network access to that proxy. It is off by default. Boolean true and numeric hop counts are rejected. The trusted proxy must overwrite forwarded headers. Never trust arbitrary internet clients' forwarded headers.
- Session and rate-bucket indexes initialize before server startup. MongoDB must permit the required unique and TTL indexes. Session/account services fail closed on database errors rather than bypass authentication or request limits.
- This migration requires everyone to sign in again. Back up production data and deploy frontend/backend together. Rolling back to the older bearer-token frontend alone will not work with this backend.

## Shared limits

Counters are atomic MongoDB documents with expiry indexes, shared across processes and server restarts. Fixed windows allow bursts near window boundaries. Keys hash account/IP identifiers; IPv6 addresses are grouped by /64 to reduce rotation within a subnet. Authenticated limits apply to the user, so logging in on another device does not reset them. IP limits also cover unauthenticated attempts. Invalid requests count. A 429 includes Retry-After and a readable wait time.

| Action | Per account | Per client IP |
| --- | --- | --- |
| API writes overall | 240/minute | 600/minute |
| Login | — | 20/15 minutes, plus 10 per email/IP pair |
| Registration | — | 10/hour |
| Password recovery request | — | 5/15 minutes |
| Reset/email confirmation | — | 10/15 minutes |
| Publish project or saved draft | 20/hour | 80/hour |
| New proposals | 10/10 minutes | 60/10 minutes |
| Offer/other hiring changes | 60/10 minutes | 240/10 minutes |
| Messages | 30/minute | 120/minute |
| Invitations | 15/10 minutes | 60/10 minutes |
| Draft writes | 30/minute | 120/minute |
| Account changes | 20/15 minutes | 100/15 minutes |
| Multipart upload attempts | 10/10 minutes | 40/10 minutes |

Upload attempts are limited after cookie/CSRF checks and before multipart parsing. Existing three-file, 10 MiB-per-file and content-type checks remain. Disk quotas, malware scanning and storage reconciliation are separate work; frequency limits do not implement those features. A reverse proxy/WAF is still needed for infrastructure-level traffic floods and request-body/connection timeouts. Per-IP limits can affect shared networks; tune them against observed usage when hosting.

## Verification

`npm --prefix backend run test:security` checks cookie flags, no secret in login JSON, restored sessions, CSRF/origin rejection, rotation, device/global logout, stream closure, absolute/idle expiry, account limits, concurrent counters and spoofed forwarded headers. It uses a uniquely named temporary database, not the application database. Existing workflow suites use the real cookie/CSRF path as well. Frontend checks cover cookie credentials, restoration, failed logout and late responses from an old session.

These changes do not configure hosting/HTTPS, validate real email delivery, or claim a full independent penetration test.

Reference guidance: [OWASP sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [Express reverse proxies](https://expressjs.com/en/guide/behind-proxies/).
