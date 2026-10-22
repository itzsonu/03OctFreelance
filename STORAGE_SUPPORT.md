# Upload management and privacy/support workflows

Implemented items 5 and 6. Event emails remain disabled; these workflows send no email.

## User-facing pages

- `/terms`, `/privacy`, `/support` are public, linked from home, sign-in and workspaces.
- Account settings show attachment allowance and deletion review status. Deletion requires the current password and explicit acknowledgement. Only one active request per owner is permitted by a Mongo unique partial index. The owner can cancel a pending review.
- Signed-in support requests use the current account email and appear only in that account's request list. Guest requests have a random private tracking code whose hash is stored in Mongo; the code is returned once and is needed to retrieve replies. A guest email is not verified and must not be treated as proof of ownership. Codes are posted in the request body, not a URL or browser storage.
- Administrators review and reply at `/admin/support`. Updates record actor, time, status and response, use version checks, and trigger an in-app notification for account owners. There is no outbound contact or guaranteed response time.

## Storage quota

- Default per account: 500 MB and 1000 files. `UPLOAD_USER_QUOTA_MB` accepts integers 1–10000; invalid configuration stops startup. Existing usage is counted and preserved, even if it exceeds a subsequently lowered limit.
- Existing 10 MB/file, 3 files/request, extension/MIME/content checks remain in force. No malware scanning is claimed.
- Mongo's single-document conditional reservation prevents simultaneous upload requests or multiple app servers bypassing the account limit. A bounded ledger includes in-flight reservations. Byte/file limits apply to all three upload flows: milestone submissions, conversations and case evidence. Metadata is written before bytes so stalled writes cannot become cleanup targets. Rollback checks references and releases reservations idempotently.
- Quotas measure application-managed attachment allocation; this is not a host filesystem capacity monitor. Configure disk monitoring and sufficient private disk space separately. All app servers must use the same private volume and Mongo database. Do not share a volume between unrelated databases or allow out-of-band writers.

## Cleanup

- `/admin/storage` shows recorded storage and maintenance history. Preview does not delete anything. Apply requires a separate explicit confirmation and an actor-bound, single-use, 15-minute token. A run handles at most 500 candidates, with checks repeated on apply.
- Only UUID-named regular files or abandoned ledger reservations **without any Attachment record** qualify after at least 24 hours. Recent files/reservations, linked directories, symlinks, unknown filenames, and every recorded attachment are protected. Storage-root resolution is checked before destructive access. Mongo failures stop further cleanup.
- Cleanup never removes Attachment documents, messages, projects, submissions or disputes. Unlinked attachment metadata is deliberately retained for manual investigation because an uncertain or interrupted domain write may have preserved evidence. Missing bytes for recorded attachments require operator recovery, not cleanup.
- A crashed cleanup stays `running`, or `failed` if the process could record the failure. Inspect the manifest/audit and storage before retrying; a new preview rechecks current state. No automatic recurring cleanup has been scheduled and no existing user data was deleted during implementation.

## Deletion is a review request

Creating, cancelling or closing a request does **not** erase or anonymize an account. Administrators must verify ownership, assess shared project/case evidence, carry out any approved data handling separately (including backups where relevant), and explain the actual outcome and retained records in their response. The UI never labels a closed review as completed data erasure. Cancelled reviews cannot be reopened by an admin.

The public terms/privacy text describes the implemented service and avoids claiming legal compliance. Before a public launch, the operator still needs to review these pages for their actual hosting/provider setup, legal identity/contact details, applicable obligations and operational retention/backup practices. This implementation does not establish those facts or promise a legal retention period.

## Focused verification

`node --test --test-concurrency=2 storageSupport.test.js integration.test.js` uses uniquely named temporary Mongo databases and a temporary private upload directory. It checks simultaneous quota attempts, legacy usage, referenced-file preservation, read-only previews, apply rechecks/token isolation, support privacy, admin version conflicts and deletion request races. Frontend focused coverage is in `src/StorageSupport.test.js` plus the existing account settings tests.
