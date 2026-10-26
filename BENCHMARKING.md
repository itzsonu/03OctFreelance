# Controlled local API performance measurements

Run from the repository root:

```text
npm --prefix backend run benchmark:api
```

Or from `backend`: `npm run benchmark:api`. This starts a new MongoDB process bound to `127.0.0.1` on a random port, creates a random `fc_benchmark_...` database, seeds fictional data, and starts a separate local API child process. It never loads `.env`, uses an existing MongoDB URI, accepts a remote API URL or connects to the deployed app. MongoDB must already be installed; on Windows the default executable is `C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe`. Set `FC_TEST_MONGOD` to an installed trusted executable if different. No package downloads, provider credentials, billing or background uptime monitor are needed.

## What it measures

Four real read endpoints use the existing middleware and database handlers:

- GET `/api/health/ready`: database ping and initialized Mongo-backed private storage readiness.
- GET `/api/projects/public?page=1&pageSize=12`: public project listing and owner checks.
- GET `/api/projects/mine?page=1&pageSize=12`: authenticated client listing, summaries and delivery analytics.
- GET `/api/task-boards/:projectId?page=1&pageSize=12`: authenticated private freelancer board, counts and summaries.

The fixture has two fictional accounts, 100 open projects, one assigned project and 30 private tasks. Real hashed MongoDB sessions are created before measurement; cookies are held only in memory. Password login, writes, uploads, AI, email, browser rendering and server-sent events are not timed. Local private storage uses the mongo backend, but no upload-throughput claim is made.

Default measurement: concurrency 1, 5 and 10; 40 requests per endpoint/concurrency per round; 3 rounds; 5 excluded warm-up reads before each measured cell. That is 1,440 measured requests plus 180 excluded warm-up reads. Concurrency order reverses on alternate rounds. The generator and API are separate processes on the same machine; MongoDB shares that host. HTTP keep-alive is enabled. Workers and external integrations do not run.

This is a closed-loop test: at most the configured concurrency is in flight, and the next request starts when a worker finishes its previous request. It is not a fixed requests-per-second arrival model, a coordinated-omission-corrected saturation study, or a count of simultaneous human users. Do not infer maximum production capacity from this small run.

## Metrics and errors

p50 is the nearest-rank median and p95 is the nearest-rank 95th percentile of client-observed latency through full JSON response and validation. Aggregate percentiles are calculated from pooled request samples, not by averaging round percentiles. JSON also contains per-round and successful-only percentiles so fast failures cannot hide slower successes. Throughput is completed requests divided by summed measured elapsed time for the cell; it is not a global mixed-workload throughput result.

An HTTP response must have status 200 and the expected fixture shape/count to succeed. HTTP errors including 429/500, transport errors, five-second total request timeouts and invalid response bodies all count as errors. Warm-up failure stops the run without claiming a passing benchmark. A report with measured errors is retained and the command exits unsuccessfully. There are no automatic per-request retries. A failed setup is not a zero-error result.

The JSON report records source revision and relevant source SHA-256 fingerprints, Node/Mongoose/MongoDB versions, OS/CPU/RAM context, fixture size, parameters, status counts, errors, timeouts, round results, aggregate results, methodology, limitations and cleanup confirmation. It deliberately omits credentials, session cookies, response bodies, machine hostname and personal accounts. A source revision alone is insufficient when uncommitted files differ; use the recorded fingerprints too.

## Parameters and safety bounds

```text
npm --prefix backend run benchmark:api -- --requests 60 --rounds 3 --concurrency 1,5,10 --projects 100 --warmup 5
npm --prefix backend run test:benchmark
```

Supported ranges: requests 20–200 per cell/round; rounds 1–5; projects 20–1000; warm-up 1–20; concurrency 1–20 with at most four levels. At most 10,000 measured requests are allowed. Requests must cover the largest concurrency. `--url`, `--base-url`, database URI and arbitrary target options are rejected. Request paths and loopback host are fixed in the implementation; redirects are not followed. The API child blocks outbound fetch integrations and receives an allowlisted environment, not production keys. The parent also removes relevant inherited provider/config values before loading the models.

Do not run beside a time-critical demonstration. Close unrelated heavy applications for repeatability and record that fact separately rather than assuming the benchmark can enforce it. Avoid comparing runs across different machines, fixture sizes, cache/warm-up states or source fingerprints without discussing those differences. Local loopback measurements exclude Vercel, Render idle wake-up, Atlas network distance, production TLS, public internet, real account data and paid/free provider limits.

## Artifacts and cleanup

Each run writes unique `.json` and `.md` files under `outputs/performance/`; existing reports are not overwritten. Temporary MongoDB files are created in a new `work/benchmark-temp/fc-api-benchmark-...` folder, rather than Windows' restricted temporary package directory. The tool stops its child API/MongoDB, drops only its own random named database, verifies the resolved cleanup directory is an owned direct child with the expected prefix, and removes only that directory. It never stops the system MongoDB service or drops an existing database. A forced process termination or machine crash can leave temporary data; inspect ownership/path before manual removal. Parent folder scaffolding may remain empty.

No real-world accuracy, deployment-time reduction, production latency SLA or before/after improvement follows from one local run. To compare an optimization later, use the same harness, fixture, parameters, machine and repeat count on both revisions, preserve both reports and inspect errors and variation before making a claim. Do not call an earlier deployed network timing a matched local baseline. Live heavy load is outside this tool's design.
