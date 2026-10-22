# FreelanceChain

A trust-aware freelance marketplace with AI-assisted matching and milestone-based project management. Built with React, Express and MongoDB.

## Current features

- Client and freelancer accounts, public project discovery, profiles and portfolios.
- Category-aware project planning and skill suggestions; optional AI planning and applicant comparison.
- Proposals, shortlists, versioned offers and mutual agreement before assignment.
- Project editing before hiring, hiring close/reopen, and cancellation with reasons and retained history. Assigned cancellations require the other participant's approval.
- Dependency-based milestones, private attachments, submissions, review, revisions and activity history.
- Mutually approved changes to active scope, planned amounts, delivery dates and unfinished milestones. Approved milestones remain unchanged; submitted work and files are retained. The original agreement and previous plans remain recorded.
- Private conversations, in-app notifications, live updates, project issue reports and admin case review.
- Account settings: current-password confirmation, password change, verified email change, and sign-out across all devices. Password/email changes revoke old sessions and pending recovery links.
- Administrator overview, account suspension/restoration, unassigned listing moderation and private decision history.
- Server pagination for workspaces, applications, applicant comparison, inbox and admin lists; cursor-based older-message loading with live catch-up. See [ADMIN_PAGINATION.md](ADMIN_PAGINATION.md).

## Run locally

1. Install Node.js and MongoDB. The project has been tested locally with Node.js 24.
2. Install dependencies from the lockfiles:

   npm ci
   npm --prefix backend ci

3. Copy backend/.env.example to backend/.env and configure MONGO_URI and a random JWT_SECRET of at least 32 characters. Keep this file private.
4. For the frontend served by Express at port 5000, set APP_ORIGIN=http://localhost:5000. Set CLIENT_ORIGIN only when serving the frontend on a separate origin.
5. Build and start:

   npm run build
   npm --prefix backend start

Open http://localhost:5000. The health endpoint is /api/health.

For frontend development, use npm start alongside the backend. Set APP_ORIGIN to the exact frontend address used for verification and reset links.

## Email and optional AI

Password recovery and email-change confirmation use the configured email provider. See EMAIL_SETUP.md and backend/.env.example. Email-change links expire after 30 minutes and password-reset links after 15 minutes. Opening a verification page does not consume the link; the user confirms explicitly.

RESET_DELIVERY=console is only supported with a localhost origin: links print in the backend terminal and no email is sent. The UI identifies this mode. Live email delivery must be configured and tested before public launch.

AI features are optional. See AI_SETUP.md. Keep the API key in the backend environment. Guided planning and ordinary comparison work without it. No live provider calls are made by the automated tests.

## Workflow safeguards

Editing a listing invalidates offers based on the earlier brief. Closing hiring preserves proposals while preventing new applications and agreement finalization.

Only project participants may request or respond to an assigned cancellation or amendment. Requesters cannot approve their own requests. While either request is pending, milestone changes pause; declining or withdrawing resumes the existing agreement. Accepting an amendment updates the current plan without overwriting the original agreement. Completed work cannot be removed or rewritten, and milestones with recorded submissions cannot be removed or given different prerequisites.

Account password changes, verified email changes and global sign-out invalidate existing sessions and close existing live connections. Email is not replaced until its one-time verification succeeds.

Authentication now uses HttpOnly cookie sessions stored in MongoDB, with CSRF checks, server logout, absolute/idle expiry and shared per-account/IP request limits. Browser tokens are no longer stored in localStorage or accepted as bearer credentials. Existing users must sign in again after this update. See [SECURITY_SETUP.md](SECURITY_SETUP.md) for limits, production HTTPS/proxy configuration and migration details.

## Verification

Frontend:

   npm test -- --watchAll=false --runInBand

Backend (requires a local MongoDB instance):

   npm --prefix backend run test:integration
   npm --prefix backend run test:lifecycle
   npm --prefix backend run test:changes

The integration suites use uniquely named temporary databases and clean up only their own test databases. TEST_MONGO_BASE may point to a dedicated test MongoDB server; do not use a production database for testing. Email delivery is mocked in the account integration suite.

## Research and deployment status

Cold-start phases 1 and 2 add guided freelancer setup, preferred work fields, explainable profile-based project suggestions and a client filter for talent without approved platform work. Newcomers need no reviews to use recommendations; portfolio samples remain separate from verified history and visibility stays opt-in. See [COLD_START.md](COLD_START.md) for implemented behavior and the remaining pilot/research evaluation.

Clients can save incomplete project briefs to their account, resume or delete them from **Saved drafts**, and publish after full validation. Drafts are private and do not appear in the marketplace. Saving is explicit; use **Save draft and close** before leaving. A stale tab cannot overwrite a newer saved draft. Publication retries recover the same project.

**Account settings → Email alerts** contains separate opt-in preferences for proposals, offers, submissions and revisions. In-app notifications remain available. Event delivery is disabled by default and awaits the final email setup; see [EMAIL_SETUP.md](EMAIL_SETUP.md). The durable queue and mocked delivery checks are implemented; real inbox delivery has not been verified.


research/ contains evaluation tooling documentation, empty consent/label templates and an explicitly synthetic example. It is not a real-world training or validation dataset. Matching and delivery outlook are decision aids, not hiring probabilities or validated outcome predictions.

Milestone amounts are planning figures. Payments, escrow, refunds and blockchain transactions are not implemented.

This repository contains the application source, not a completed public deployment. Production hosting, HTTPS, durable private storage, backups, operational monitoring, malware scanning and a production security review still require setup. Cookie sessions and shared application request limits are implemented; hosting configuration and infrastructure traffic protection remain deployment work.

.env files, private uploads, installed dependencies, generated builds, logs and private research data/results are excluded from Git. Historical PHASE_* and QA reports describe earlier snapshots; the current source and tests are authoritative.

Upload quotas and preview-confirmed orphan cleanup are implemented, alongside public Terms/Privacy pages, private support requests/admin replies, and password-confirmed account deletion review requests. Actual erasure remains a separate administrator data-handling operation. See [STORAGE_SUPPORT.md](STORAGE_SUPPORT.md) for limits, safety rules and launch policy review requirements.

Hosting preparation, readiness/liveness probes, graceful shutdown and offline database/private-file recovery tools are documented in [DEPLOYMENT.md](DEPLOYMENT.md). A public deployment and production recovery rehearsal remain pending.
