# FreelanceChain

A MERN workspace for client projects, freelancer proposals, and milestone approval.

## What this version includes

- Client and freelancer registration and login.
- Password recovery by a one-time link that expires after 15 minutes. Old login sessions are invalidated after a reset.
- Expired sessions return users to login with a clear message. Login and registration attempts are limited on each server instance.
- Clients create projects with a detailed brief, required skills, budget, deadline, and up to 20 planned milestones.
- Clients can preview a guided milestone draft from their brief, skills, and budget, then apply and edit it before publishing.
- Clients can explicitly request an AI-assisted milestone draft when a backend OpenAI key is configured; they preview and edit it before publishing.
- Freelancers maintain a professional profile with skills, experience, bio, and portfolio link.
- Freelancers search/filter open projects, review the full brief, send a proposal, and track application status.
- Clients review proposals alongside applicant profiles and assign one freelancer.
- Clients choose milestone prerequisites, and dependent steps unlock when every prerequisite is approved.
- Assigned freelancers submit work; clients can approve it or request a revision with feedback. Resubmissions retain their history.
- The project view shows progress, prerequisites, submissions, and an activity record for new actions.
- Freelancers can see a trust score based on approved milestones and revisions. Clients see each applicant's verified history and an explained fit estimate.
- Clients can explicitly request an AI-assisted applicant comparison when an OpenAI API key is configured; the regular shortlist remains available without one.
- Client dashboards highlight overdue deadlines, pending reviews and open revisions with explicit reasons; project pages show the same attention signals.
- Active projects show a delivery outlook from observed approval pace, repeated revisions and inactivity, with a suggested next step and clear uncertainty.
- Authenticated live update signals refresh client and freelancer workspaces, applicant lists and milestone pages when another user changes a project.
- Responsive homepage, auth screens, dashboards, and milestone view.

The milestone amounts are **planning figures only**. This version does not process payments. The guided draft uses fixed templates and keyword signals; it is not a trained AI model. The optional AI draft proposes steps and relative weights; the backend validates dependencies and calculates amounts. Matching is a transparent, rule-based estimate, not a prediction of project success.

AI milestone drafting sends the title, brief, skills, budget and deadline to OpenAI only after the client clicks **Draft with AI**. The interface asks clients to remove personal information first. API responses are requested without storage (`store: false`); no draft is stored locally until the client publishes a project. If the AI service fails or returns an invalid plan, the client can still use the guided draft or enter steps manually. The route is client-only and has a one-minute request cooldown. Set `OPENAI_API_KEY` on the backend to enable it; `OPENAI_PLAN_MODEL` can override the default `gpt-4o-mini`. A live model has not been exercised in this local demo without a key.

## Delivery outlook

For an active project with at least two approved milestones at least a day apart, the app calculates the observed days between approvals and projects a rough finish date for the remaining milestones. It compares that date with the deadline and separately flags repeated revisions on unfinished work or at least seven days without recorded activity. If there is too little approval history, it says so instead of inventing a date. The client dashboard and project page show the evidence and a suggested next action. This is a transparent baseline, not a trained AI risk model or a probability of failure. It has not been calibrated on historical project outcomes.

## Live updates

The backend provides an authenticated event stream at `GET /api/updates`. It sends only an update type and project ID to the project client or assigned freelancer; the browser then fetches fresh data through the existing protected API. New or assigned projects also signal freelancer marketplace views, and new applications signal the relevant client. The UI shows **Live updates** while connected and reconnects after a temporary disconnection. A reconnect refreshes the visible data to catch missed events. The stream is in memory on one backend process; a deployment using multiple server instances needs shared pub/sub for cross-instance updates.

## Trust and matching

Trust is calculated from approved milestones. A milestone with one or more revision requests counts as revised once in the score, so repeated requests on that milestone cannot keep reducing it. Each client account contributes at most three approval-equivalents, even across multiple projects. Revised approvals fill those slots first, so extra clean milestones from the same account cannot dilute existing revisions. This limits score inflation from splitting one client's work into many small milestones. The score is drawn toward a neutral baseline when there is little capped evidence; freelancers with no approved milestones are shown as **New** without a numeric score. The profile and shortlist show the raw approval count, the capped count, the number of client accounts, completed projects, and revision requests. This is a limited safeguard, not identity verification or proof that client accounts are independent. Self-reported profile fields cannot directly change trust.

The client shortlist compares case-insensitive skill names (70% weight), self-reported years of experience (15%), and verified trust (15%). If trust is unavailable, its weight is removed and the remaining weights are normalized, so new freelancers are not penalized for missing history. The UI shows matched and missing skills and keeps the hiring decision with the client. This is an explainable starting point for later AI research, not a trained recommendation system.

The optional AI comparison uses `text-embedding-3-small` embeddings to compare the project brief with applicant profile/proposal text, then combines text similarity (60%) and the regular fit estimate (40%). The client must choose **Compare with AI**; the page says which text goes to OpenAI. No vectors or AI rankings are saved. Scores are ordering aids, not hiring probabilities. Set `OPENAI_API_KEY` in the backend environment to enable it. See [MATCHING_EVALUATION.md](MATCHING_EVALUATION.md) for the synthetic diagnostic result and what is still needed for a real validation claim.

## Run locally

1. Install Node.js and start a local MongoDB server.
2. In `backend`, run `npm ci`, copy `.env.example` to `.env`, and set a unique `JWT_SECRET` of at least 32 characters.
3. Run `npm start` in `backend` (default API: `http://localhost:5000`). The server waits for MongoDB before accepting requests.
4. In the project root, run `npm ci` and `npm start` (default UI: `http://localhost:3000`).

For a different backend address, set `REACT_APP_API_URL` in a root `.env.local` file, for example `REACT_APP_API_URL=http://localhost:5000/api`.

For a single-service production build, run `npm run build` in the project root, then `npm start` in `backend` with `NODE_ENV=production`, `MONGO_URI`, and `JWT_SECRET` set. The backend serves the built frontend and API from one origin, so no frontend API URL override is needed. Set `CLIENT_ORIGIN` only when the frontend lives on a separate origin. `GET /api/health` reports database connectivity. Do not seed demo data in production.

Password recovery needs `APP_ORIGIN` set to the frontend origin. For Gmail delivery during a small local demo, set `RESET_DELIVERY=gmail`, `GMAIL_USER`, and `GMAIL_APP_PASSWORD` in `backend/.env`; see [EMAIL_SETUP.md](EMAIL_SETUP.md). For a public deployment using Resend, set `RESEND_API_KEY` and `RESET_FROM_EMAIL` instead. For a local demo only, set `RESET_DELIVERY=console` and use a localhost `APP_ORIGIN`; the reset link is printed in the backend terminal and is never returned by the API. The forgot-password page states whether this server sends email or prints a local link. Public deployments should use HTTPS and a suitable email provider. The request endpoint gives the same response for registered and unknown addresses and limits repeat requests.

## Check the build

Run `npm test -- --watch=false` and `npm run build` from the project root. Run `node workflow.test.js`, `node scoring.test.js`, `node insights.test.js`, `node outlook.test.js`, `node planner.test.js`, `node aiPlanner.test.js`, `node resetMail.test.js`, `node semanticMatching.test.js`, `node liveUpdates.test.js`, and `node integration.test.js` in `backend`. The integration test needs local MongoDB; it creates and removes only its own uniquely named test database. `npm run eval:matching` runs the fictional matching diagnostic without an API key.

See [DEMO_GUIDE.md](DEMO_GUIDE.md) for a repeatable capstone demo and local demo data.

## Current scope

The working source now includes phases 1–16: workflow repairs, a frontend refresh, the core marketplace journey, milestone revisions/dependencies/activity, a trust-aware shortlist, real-database workflow testing and demo setup, transparent project attention analytics, an editable guided milestone draft, password recovery, an opt-in embedding comparison with a diagnostic evaluation harness, optional AI-assisted milestone drafting, a transparent delivery outlook, final workflow/auth checks, live project update signals, a per-client trust evidence cap, and a mobile/keyboard accessibility pass with Gmail reset delivery support. The Phase 13 [FINAL_QA_REPORT.md](FINAL_QA_REPORT.md) is a historical checkpoint. Live Gmail delivery still needs account credentials to verify. Live model behavior and real-world relevance/fairness remain unvalidated without an API key and consented labelled data. The attention and outlook signals are not a trained predictive AI risk model. Older projects without explicit dependencies continue to unlock sequentially; earlier actions cannot be reconstructed into the new activity record.
#   0 3 O c t F r e e l a n c e  
 