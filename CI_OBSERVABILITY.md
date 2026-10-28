# CI and basic observability

## Continuous integration

`.github/workflows/ci.yml` runs on relevant pushes to main and pull requests, with optional manual workflow dispatch. Documentation-only changes outside watched paths are skipped. Frontend runs the React tests, hosting configuration checks and production build on Node 24. Backend runs root backend tests sequentially plus benchmark metrics checks against an ephemeral MongoDB 8.0 service. Each test's randomly named test database remains isolated from production. Dependency installation uses the tracked lockfiles. Jobs have 15-minute limits, read-only repository permission, non-persisted checkout credentials, and cancellation of superseded runs.

The workflow receives no production database, mail, AI, hosting or deployment secrets and contains no deployment step. It uses pull_request, never pull_request_target. Render deployment remains manual. Existing Vercel Git integration may still deploy independently: this workflow does not gate that integration or enforce branch protection. A workflow file is not proof of a successful run; use the exact commit's Actions result. Repository owners can separately decide whether to require its frontend/backend checks before merging. Do not silently change branch permissions or billing.

Actions versions follow the official checkout and setup-node usage at implementation time. Update deliberately. Sources: https://github.com/actions/checkout and https://github.com/actions/setup-node .

## Runtime logs and correlation

The API generates a fresh UUID X-Request-ID response header; caller-supplied IDs are ignored. Logging begins before proxy/origin/auth rejection. Each completed or aborted request emits one JSON api_request record containing only timestamp, generated ID, allowlisted method, fixed route group, numeric status, duration, abort flag and stream flag. Raw URL paths/record IDs, queries, IP addresses, cookies, headers, bodies and response content are not logged by this middleware. Logging failures do not change business responses. Existing older application logs are not all converted by this change.

AI operations emit ai_operation JSON with generated request ID when called inside an API request, provider/feature allowlist, safe outcome and duration. Prompt text, applicant profiles, provider response text and exception messages are never added. AsyncLocalStorage preserves correlation across asynchronous calls. Configured validated planning operations and embedding batches are counted; missing configuration, initial input rejection, cached sample responses and later local ranking validation are not external-provider attempts. Outcomes distinguish quota, access, timeout and other failures. There are no automatic AI retries or new provider calls caused by instrumentation.

Set OBSERVABILITY_LOGS=false on the backend to suppress these new JSON logs while keeping counters. Default logging is enabled outside NODE_ENV=test; it is disabled in tests unless explicitly supplied with a test writer. This is a new optional backend variable. No secret or frontend build setting is needed.

## Private counters

GET /api/admin/operations uses the existing cookie session and admin role guard. Anonymous requests receive 401 and clients/freelancers receive 403. It returns per-process counters since startedAt, grouped by fixed method/route/status family; noncumulative duration buckets; and AI attempt/success/failure, quota/access/timeout and duration totals. Bucket upper bounds in milliseconds are 50, 100, 250, 500, 1000, 5000 and null for the final unbounded bucket. These buckets are not exact p50/p95 values. Use the controlled benchmark for actual sample percentiles.

Server-sent update stream lifetimes are logged but excluded from duration buckets/totals. A browser closing its stream is not necessarily a backend failure. Requests currently in flight are not counted until finish/close. The metrics request itself completes after its snapshot, so its own completion may appear only on a later snapshot.

The admin can open the same-origin /api/admin/operations URL while signed in, or use the browser Network panel to locate a failed request's X-Request-ID and search the dedicated backend logs for that generated value. Do not send session cookies or copied credential-bearing requests to support. There is no new public metrics endpoint, third-party telemetry account, analytics tracker or additional admin UI panel in this change.

Counters are bounded in cardinality, in memory and process-local. They reset on restart/free-instance sleep and are not aggregated across instances. Logs depend on the hosting provider's retention. This is basic diagnosis support, not a durable monitoring system, alerts, distributed tracing, a latency SLA or an AI-accuracy measure. Private request data is not exported to a new service.

## Release and verification

Frontend behavior is unchanged. Backend instrumentation requires a deliberate backend release; adding files to GitHub alone does not activate it on a manually deployed Render service. Deploy only after the intended commit's CI passes, preserve current environment/database/proxy settings, check readiness and one generated X-Request-ID header, then confirm the existing admin role can read operations. Never generate AI traffic merely to make counters nonzero; mocked tests verify failure classification without using provider quota.

Local focused checks: `node --test backend/observability.test.js backend/aiPlanner.test.js backend/semanticMatching.test.js backend/geminiAi.test.js` from root. CI additionally verifies database-backed workflows using its disposable service. Public deployment health and a private admin metrics check are separate evidence from unit tests.
