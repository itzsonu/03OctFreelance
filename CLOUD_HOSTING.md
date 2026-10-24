# Vercel frontend / Render backend demo

The separate FreelanceChain demo was deployed on 23 October 2026. Frontend: https://freelancechain-demo.vercel.app. Backend: https://freelancechain-api-zje1.onrender.com. It uses a dedicated FreelanceChain Render Hobby workspace, a Free Node service and a dedicated Atlas project/database. Semfolio remains a separate app. Do not connect this repository/blueprint to its service or reuse its database name, session secret or environment group.

## Isolation and accounts

Use a new FreelanceChain Render web service. Services do not overwrite each other, but a workspace shares free instance hours, bandwidth and build allowances. Free web services receive 750 shared instance hours per calendar month. If Semfolio is a static site, it does not consume free web-service instance hours; its bandwidth/build usage still shares workspace allowances. If it is a free backend, both consume the same workspace pool. A separate Hobby workspace is supported by Render and can keep project administration separate; a second login account is not required. Confirm actual workspace allowances before publishing. Free services sleep after 15 idle minutes and may take about a minute to resume.

## Login and API routing

The browser always calls its own /api path. Vercel forwards that path to the new backend; it never redirects the browser to the onrender.com API domain. Existing host-only HttpOnly, Secure, SameSite=Lax cookies therefore remain on the frontend's HTTPS origin. The session token hash, expiry and revocation state stay in MongoDB; the stable backend JWT_SECRET signs CSRF values. Do not change it on each deploy.

The root vercel.mjs configuration requires FREELANCECHAIN_BACKEND_ORIGIN (the exact new HTTPS backend origin, no trailing slash) and FC_PROXY_SECRET (32–256 random characters). Put the SAME proxy secret on Render. It is a server configuration variable, never REACT_APP_*. Leave REACT_APP_API_URL unset or /api; configuration rejects direct cross-site URLs. No permissive SameSite=None or wildcard CORS fallback was introduced.

The Vercel SDK emits an origin request-header transform using deploymentEnv, rather than including the secret in React assets. The backend validates that secret before API handling, and only then accepts Vercel's single valid X-Real-IP for rate limiting. Arbitrary client forwarded headers remain untrusted. Public read-only liveness/readiness probes remain available for Render's health check. API responses and external rewrites disable caching.

Set Render APP_ORIGIN to the exact stable production Vercel origin. Arbitrary preview origins are not automatically allowed; use an explicitly configured isolated preview backend/database if needed. Production/preview cookies must never share a Domain attribute.

## Private uploads without a persistent Render disk

Set PRIVATE_UPLOAD_BACKEND=mongo. The new privatefiles collection stores binary bytes, size and SHA-256 under random server-generated keys, separate from Attachment metadata and all project/profile responses. Existing participant/admin authorization still governs downloads. No public attachment URL or bucket is created. A single file stays below 10 MiB, safely below MongoDB's 16 MiB document limit. Content signature/type checks and three-file request limits remain.

Mongo-mode defaults are 20 MiB per user and 100 MiB shared attachment allowance, with a shared 10,000-file ceiling. UPLOAD_USER_QUOTA_MB and UPLOAD_SHARED_QUOTA_MB are configurable. Atomic per-user and shared reservations cover concurrent uploads; failed writes release only known-unused reservations. The shared allowance is not the entire Atlas database quota: users, indexes, sessions and history need additional space. Dedicated/free Atlas capacity must be reviewed at launch. Use private object storage for larger deployments instead of raising these limits without a capacity plan.

Quota previews/cleanup include abandoned Mongo files and reservations with the existing 24-hour grace period. Recorded Attachment evidence is always protected. Cleanup remains preview-confirmed and administrator-only. Admin storage responses include shared usage.

Local storage remains the default for existing local/Docker installations. New metadata records its backend, so Mongo-mode downloads never silently reinterpret an old local attachment as cloud bytes.

## Existing data and migration

Use a NEW database for FreelanceChain, separate from Semfolio. No automatic data reset, copy or migration runs at startup.

Before switching an existing installation, take a verified offline backup and copy/restore its data and private files to the intended isolated target. With MONGO_URI and PRIVATE_UPLOAD_DIR privately configured for that target:

    cd backend
    node scripts/migratePrivateUploads.js

This previews local attachments, validates source bytes, compares any existing Mongo copies and checks shared capacity without modifying metadata or copying files. Run from backend so its private .env is loaded.

Stop all target app instances/writers, then apply to that explicitly configured database:

    node scripts/migratePrivateUploads.js --apply --offline-confirmed --app-url http://127.0.0.1:5000

Use the actual stopped app URL. The tool refuses a responding app. It copies bytes, verifies hashes, then marks each existing Attachment as mongo while keeping its ID and storage key. It never removes original local files, users or project records. Interrupted migrations can be resumed; conflicting copies stop for review. After success, set PRIVATE_UPLOAD_BACKEND=mongo and restart. Keep the original backup and local files until downloads have been verified.

Offline backup/restore now includes privatefiles and its shared reservation ledger in the existing canonical BSON exports, verifies referenced Mongo bytes, and supports a missing local upload directory when every recorded attachment is in MongoDB. Old local-file snapshots remain supported. Actual production recovery rehearsal is still pending.

## Current hosting configuration and setup reference

- Vercel: import the repository root; vercel.mjs supplies build/output, API forwarding, SPA routes and security/cache headers.
- Render: create a NEW service using deploy/render-free.yaml (or equivalent dashboard settings), with backend as root directory and /api/health/ready as health check. Auto-deploy is off in the template. Supply private values from deploy/cloud.env.example.
- MongoDB: use a dedicated named application database and credentials restricted to it. Keep connection strings out of Git and browser variables.
- Keep EVENT_EMAILS_ENABLED=false. Email provider setup remains last.

The provider accounts are connected and the private Production environment values are configured. Vercel forwards to the actual backend origin; Render APP_ORIGIN is the production frontend origin, PRIVATE_UPLOAD_BACKEND=mongo and EVENT_EMAILS_ENABLED=false. Atlas allows the two approved Render Singapore outbound ranges; a user-selected temporary setup IP has an expiry. No global internet access-list entry was added. Live signed-in logout, file upload/download after redeploy and stream reconnects still require verification.

The single Render process runs existing in-app reminder/email workers. Sleeping services cannot deliver reminders until they resume; due reminders catch up. Live events are process-local, so horizontal scaling requires shared event transport.

References: [Render free instances](https://render.com/docs/free), [Render workspaces](https://render.com/docs/team-members), [Vercel external rewrites and origin protection](https://vercel.com/docs/routing/rewrites), [programmatic Vercel configuration](https://vercel.com/docs/project-configuration/vercel-ts), [MongoDB small-file guidance](https://www.mongodb.com/docs/manual/core/gridfs/).

## Verification completed locally

The cloud integration suite exercises a same-origin forwarding proxy, production cookie flags, CSRF, origin authentication, participant/admin downloads, rejected file content, persisted sessions/bytes after backend/database reconnect, concurrent shared quotas, protected orphan cleanup, safe migration resume, and canonical BSON backup/restore without local file storage. Existing session/security, local storage/support and recovery suites also pass. The health test now respects TEST_MONGO_BASE instead of requiring the real database service. The Vercel routing SDK configuration check, focused frontend storage/session checks and production React build pass. These isolated local checks do not establish full hosted workflow coverage. Live checks additionally confirmed readiness 200, same-origin session response 200 with Secure/HttpOnly cookie attributes, no-store API responses, protected task-board API 401 without a session, direct backend API 403 without the proxy secret, and working homepage/login SPA routes. Vercel and Render deployed the routing fix successfully. Actual authenticated uploads, post-redeploy downloads and live stream reconnects remain unverified.

## Browser sessions

A browser profile shares its host-only session cookie across tabs. Signing in as a different account changes that cookie for every tab. Successful login/logout and session expiry publish only a change signal to other tabs; they clear the old in-memory account and page state before protected routes restore the current server session. Same-role account switches also remount private pages. BroadcastChannel is preferred, with a storage-event marker fallback; no credentials or account details are placed in those signals. If both mechanisms are blocked, refresh existing tabs after switching accounts. Use separate browser profiles/private windows for simultaneous client and freelancer demos.

Temporary HTML/proxy failures are presented as retryable service errors, rather than empty project/session data. Writes are never automatically replayed. Invalid session payloads cannot silently confirm a login or replace the remembered account.

### Free AI demo with Google Gemini
Set `AI_PROVIDER=gemini` and `GEMINI_API_KEY` privately in Render. Keep the Google AI Studio project on **Free** with no billing account attached. Models: `gemini-2.5-flash-lite` for structured milestone drafts and `gemini-embedding-2` for text comparison. Free quota can exhaust; failures retain guided planning and ordinary matching, with no automatic retry, paid-provider switch or billing upgrade. Google free-tier content may improve its products: remove personal/confidential information and use synthetic records for the demo. The UI names the actual provider before either action. Local `npm run ai:check -- --live` makes exactly two synthetic requests; configuration-only mode makes none. Secret keys belong only in backend environment variables, never React build variables, Git or chat.
