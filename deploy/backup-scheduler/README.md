# Optional free cloud backup scheduler

This setup runs in the owner's Google Apps Script account, including when the
owner's computer is off. It does not install a Codex automation, require a paid
Render cron service, pause the website or store a database password in Google.
Google/hosting quotas and network failures still apply; it is not an uptime SLA.

The feature is **disabled until all three backend settings are configured**:

| Setting | Purpose |
| --- | --- |
| CLOUD_BACKUP_SCRIPT_CLIENT_ID | Exact audience of the private scheduler's Google identity token |
| CLOUD_BACKUP_OWNER_EMAIL | Verified Google owner allowed to export backups |
| CLOUD_BACKUP_PUBLIC_KEY | Base64 DER/SPKI RSA public key, minimum 3072 bits |

These are configuration identifiers/public encryption material, not a private
decryption key. Do not put the private key or its passphrase on Render, in
Apps Script properties, in this repository or with the encrypted backup files.
Existing database/application credentials remain server-side.

## One-time owner setup

1. Use the owner-only local key launcher supplied with the private operations
   materials, or run backend/scripts/createCloudBackupKey.js through a launcher
   that first protects FC_BACKUP_KEY_ROOT for the owner. The interactive tool
   creates an encrypted PKCS8 private recovery key and public-config.json,
   with a synthetic encryption/decryption self-check.
2. Save the encrypted private-key file and its passphrase separately and safely.
   A future public key cannot recover data encrypted for a lost private key.
3. Create an owner-only Google Apps Script project. Put Code.gs and
   appsscript.json from this directory in it. Use its default Google Cloud
   project; the manifest enables Drive v3 without a service-account key.
4. Review and authorize setupBackup yourself. The explicit drive.file scope
   restricts Drive operations to files/folders this app creates or receives
   app-specific access to. The scheduler creates a **separate owner-only**
   FreelanceChain_Private_Automatic_Backups folder. The earlier manual backup
   folder is preserved. It is not published as a web app.
5. setupBackup logs only the audience/client ID, owner email and folder link,
   never its OAuth or identity tokens. Configure the three backend settings.
   In Apps Script project properties set EXPECTED_KEY_FINGERPRINT to the
   SHA-256 fingerprint from the local public-config.json.
6. Deploy the backend normally. Run installWeeklyBackup from Apps Script.
   It first requires a successful actual export, Drive upload, owner-only
   permission readback and encrypted download/hash comparison. Only after
   that does it create one Sunday trigger at approximately 03:00-04:00
   Asia/Kolkata. Time-driven trigger execution is not an exact-minute promise.
7. Download the first encrypted .jwe into a restricted local folder and use
   backend/scripts/decryptCloudBackup.js through the private owner launcher,
   with the separate encrypted recovery-key file. It authenticates/decrypts,
   limits ZIP extraction, verifies manifest hashes and recounts records.
   A verified decryption is distinct from a full database/application restore.

## Data and authorization boundaries

Only /api/backup-cloud/v1 is mounted before the normal frontend proxy gate.
It uses its own strict server-to-server Google OIDC audience, verified owner
email and short-lived token verification. Browser cookies/admin sessions do
not authorize it; Origin-bearing requests are refused. Other API routes keep
their normal proxy, CSRF and application-session controls. Response caching
is disabled. Unconfigured exports fail closed. Tokens, archive plaintext and
database errors/records are not logged.

All document and attachment reads share one snapshot-enabled MongoDB session
and therefore one server-provided atClusterTime. Failure to obtain snapshot
isolation, schema metadata changes, snapshot expiry, missing/corrupt file bytes,
local-filesystem uploads, excess size/time or unsupported collection types
abort the run. There is no fallback to an inconsistent live dump. DDL/schema
migrations must not overlap backups; collection/index metadata is checked
before and after rather than claimed to be snapshot-pinned.

The ordinary-collection logical snapshot uses the existing recovery manifest
format and BSON EJSON gzip members. Its manifest explicitly records online
session-snapshot consistency. Sessions, rate buckets, Google login challenges
and old restore claims are excluded. This is not a physical/cluster snapshot
or point-in-time recovery service. The existing restore utility invalidates
restored account-recovery links and skips old pending event emails.

A bounded ZIP is encrypted with standard compact JWE (RSA-OAEP-256/A256GCM)
using jose. Only ciphertext, byte count/hash, key fingerprint and non-record
summary counts leave the backend. The scheduler verifies the expected key,
uploads, reads permissions/size/parent and downloads the ciphertext to compare
SHA-256. It keeps all generations; no automatic deletion/trashing is enabled.
A pre-existing verified copy for the same local date is reused rather than
silently replacing it. Duplicate triggers/copies require owner review.

## Operation and recovery

Review Apps Script Executions and its normal trigger-failure notifications.
Check LAST_VERIFIED_BACKUP in script properties; an invocation is not success.
On failure inspect safe status/code, provider connectivity, granted scopes,
key fingerprint and storage quota. Never disable TLS validation, broaden Atlas
network access or restore over the production DB to make a backup pass.

Current bounds: 32 MiB of serialized source records, a 16 MiB ZIP, at most 200
ordinary collections and a 90-second data-reading deadline (plus bounded
metadata operations). Exceeding limits requires a reviewed larger backup
workflow, not truncation. Google execution/URL-fetch limits are additional.
The first live Atlas snapshot and Google trigger run must be independently
verified before claiming this optional deployment is operational.

For a restore, decrypt into a fresh private folder; use the matching
backend/recovery.js verification and fresh-local-database restore procedure.
Never overwrite the live database. Retain original snapshots, source revision,
key fingerprint and verification reports. Plan a separately approved production
cutover; do not confuse backup success with a full disaster-recovery rehearsal.

References: [MongoDB snapshot reads](https://www.mongodb.com/docs/manual/tutorial/long-running-queries/),
[Apps Script identity tokens](https://developers.google.com/apps-script/reference/script/script-app#getidentitytoken),
[advanced services](https://developers.google.com/apps-script/guides/services/advanced),
[JOSE](https://github.com/panva/jose).
