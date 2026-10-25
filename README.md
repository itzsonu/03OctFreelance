# FreelanceChain

An AI-assisted freelance collaboration platform for discovering projects, reviewing proposals, agreeing on work, and managing delivery through milestones.

FreelanceChain connects clients and freelancers in a shared workflow—from publishing a project to reviewing the final deliverable. It also includes private task boards for freelancers, project conversations, notifications, account recovery, and administrative tools.

**Live application:** https://freelancechain-demo.vercel.app  
**Repository:** https://github.com/itzsonu/FreelanceChain

> **Project snapshot: 25 October 2026**
>
> The application is deployed as a functional demonstration. Core hiring and milestone delivery flows have been exercised on the live application. AI planning and comparison have also been exercised with Google Gemini.
>
> Independent real-world AI accuracy evaluation and some production operations work remain pending. Google sign-in is currently configured in Testing mode.

---

## Table of Contents

- [Overview](#overview)
- [User Roles](#user-roles)
- [Features](#features)
- [Project Workflow](#project-workflow)
- [AI Features](#ai-features)
- [Matching and Trust](#matching-and-trust)
- [Private Task Boards](#private-task-boards)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Data Storage](#data-storage)
- [Authentication and Security](#authentication-and-security)
- [Local Installation](#local-installation)
- [Environment Configuration](#environment-configuration)
- [Cloud Deployment](#cloud-deployment)
- [Testing and Verification](#testing-and-verification)
- [AI Accuracy Evaluation](#ai-accuracy-evaluation)
- [Important Application Routes](#important-application-routes)
- [Repository Structure](#repository-structure)
- [Troubleshooting](#troubleshooting)
- [Current Limitations](#current-limitations)
- [Future Work](#future-work)
- [Documentation](#documentation)

---

## Overview

Freelance projects often involve more than finding a person with matching skills. Clients and freelancers also need to agree on the scope, clarify expectations, track progress, exchange files, and preserve a record of decisions.

FreelanceChain brings these activities into one application.

A client can publish a project, review applicants, compare relevant experience, and send an offer containing the proposed terms and milestones. Once both participants agree, the freelancer can deliver the work in stages. The client can approve a submission or request revisions.

Freelancers also have private planning tools to organize their own tasks without exposing internal notes to the client.

### Main objectives

- Make project requirements and delivery expectations clear.
- Support category-aware project planning.
- Help clients compare applicants using explainable matching signals.
- Keep agreement versions and project changes recorded.
- Track delivery through milestone dependencies.
- Give freelancers a private workspace for daily planning.
- Preserve conversations, submissions, and review history.
- Provide AI assistance while keeping final decisions with users.

### Scope of the name

“FreelanceChain” refers to the connected project and milestone workflow.

The current application does **not** implement a blockchain network, cryptocurrency payments, escrow, or smart contracts.

---

## User Roles

| Role | Main responsibilities |
|---|---|
| Client | Publish projects, review proposals, agree on terms, review submissions, and manage project changes |
| Freelancer | Build a profile, discover projects, send proposals, accept terms, deliver milestones, and manage private tasks |
| Administrator | Review platform activity, handle support and reported issues, moderate eligible listings, and suspend or restore accounts |

Public registration supports Client and Freelancer accounts.

Administrator access is separate from public registration. Google sign-in does not create administrator accounts.

---

## Features

### Client workspace

- Create and publish projects.
- Select a project category.
- Describe the specific field when choosing Other.
- Add required skills, a budget, and a delivery deadline.
- Request skill suggestions from the project brief.
- Generate a guided milestone plan.
- Request an AI-generated milestone draft when configured.
- Review suggested plans before applying them.
- Save incomplete project drafts privately.
- Resume, update, delete, or publish saved drafts.
- View proposals and applicant details.
- Filter applicants by budget compatibility and availability.
- Shortlist applicants.
- View regular fit explanations and available work evidence.
- Request AI-assisted applicant comparison.
- Send versioned offers containing project terms and milestones.
- Review milestone submissions.
- Approve work or request revisions.
- Propose changes to an active agreement.
- Request or respond to an assigned project cancellation.
- Maintain company information shown with public project briefs.

### Freelancer workspace

- Create and update a professional profile.
- Add skills, experience, preferred categories, and portfolio information.
- Set availability and talent-directory visibility.
- Discover projects and read public briefs.
- Save projects for later.
- Receive and respond to invitations.
- Submit, update, or withdraw eligible proposals.
- Review offers and agreement history.
- Participate in the offer and counter-offer workflow.
- Accept agreed terms before assignment.
- Submit milestone work and private attachments.
- Respond to revision requests.
- Use project conversations.
- Organize work through private task boards.
- View tasks across active projects.
- Schedule in-app task reminders.

### Shared collaboration features

- Project conversations and inbox.
- Private file access for authorized participants.
- In-app notifications.
- Live workspace updates.
- Milestone activity and submission history.
- Versioned agreements.
- Controlled project amendments.
- Cancellation requests with retained reasons and history.
- Account settings and session management.
- Password recovery and email verification.
- Support requests and administrative replies.

### Administrative features

- Platform overview.
- Account suspension and restoration.
- Moderation of eligible unassigned listings.
- Review of reported project issues.
- Private case decisions and history.
- Support request handling.
- Storage usage and maintenance tools.
- Review of account deletion requests.

An account deletion request does not immediately erase project records. Actual data handling remains a separate administrative operation.

---

## Project Workflow

### 1. Create the project

The client enters the project category, brief, required skills, budget, deadline, and proposed milestone plan.

Suggestions depend on the selected field. Choosing Other allows the client to describe the project’s actual field.

An unfinished brief can be saved as a private draft.

### 2. Publish and receive proposals

Once published, the project becomes available for discovery.

Freelancers can review the brief and submit proposals describing their approach, proposed amount, and estimated delivery time.

Submitting a proposal does not assign the project.

### 3. Review applicants

The client can inspect proposals, shortlist applicants, review fit explanations, and optionally request AI comparison.

Comparison scores support review. They do not automatically select or hire a freelancer.

### 4. Agree on terms

The client proposes the work terms and milestone plan through an offer.

Offer versions preserve the history of the agreement process. Both participants must agree before the project is assigned.

An outdated offer cannot be accepted as though it described the latest project brief.

### 5. Deliver milestone work

The assigned freelancer submits work through the milestone workspace.

Milestone dependencies determine which steps are available. A later milestone can remain locked until its required earlier steps are approved.

### 6. Review or request revisions

The client can approve a submitted milestone or request changes.

Submission and review history remain available. A stale review action cannot silently approve a different, newer submission.

### 7. Complete the project

After all required milestones are approved, the project reaches its completed state.

Private task-board completion is separate from this process. Marking a personal task Done does not approve client work.

### Changes during delivery

Active scope changes use a mutual amendment workflow.

Changes can affect eligible unfinished milestones, planned amounts, and delivery dates while preserving the original agreement and previous plans.

Completed work cannot simply be removed or rewritten.

Assigned project cancellation also requires the other participant’s response.

---

## AI Features

FreelanceChain separates ordinary application logic from external AI requests.

### Features that work without an AI key

- Category-aware guided milestone planning.
- Skill extraction from supported terms in a project brief.
- Regular applicant matching.
- Trust and verified-work explanations.
- Shortlisting.
- Hiring and offer management.
- Project delivery and private task boards.

The skill suggestion catalogue is deterministic. It should not be described as a trained language model.

### AI milestone drafting

The client can explicitly request an AI-generated plan.

The request uses the entered project information, including the brief, field, required skills, budget, and deadline.

The returned draft must pass application validation and is presented for review. It is not automatically published or applied to the project.

If generation fails, the existing project input remains available and the client can use the guided fallback.

### AI applicant comparison

The comparison flow sends relevant project text and pending applicants’ profile/proposal text to the configured AI provider.

The backend obtains embeddings, calculates text similarity, and combines that similarity with the regular fit score.

```text
Combined comparison score =
    60% semantic text similarity
  + 40% regular explainable fit
```

The result shows the comparison components so the client can review the ranking.

This score is an ordering aid. It is not a probability of successful delivery.

### Supported providers

| Provider | Configuration | Model configuration in this snapshot |
|---|---|---|
| Google Gemini | `AI_PROVIDER=gemini` and `GEMINI_API_KEY` | Planning: `gemini-3.5-flash-lite`; matching: `gemini-embedding-2` |
| OpenAI | `AI_PROVIDER=openai` and `OPENAI_API_KEY` | Planning: `gpt-4o-mini` by default; matching: `text-embedding-3-small` |

These names describe the current source configuration. Future provider availability and model changes must be reviewed before changing the integration.

The deployed demonstration uses Google Gemini.

### Failure handling and usage control

- AI requests start through explicit user actions.
- Request limits and cooldowns reduce repeated calls.
- Provider errors do not automatically switch providers.
- Failed AI output is not replaced with a fabricated successful result.
- Regular comparison and guided planning remain available.
- The sample comparison caches successful synthetic results temporarily.
- Application code does not automatically retry paid generation requests.

### Three-profile sample demonstration

The Client dashboard includes a fictional writing project and three authored applicant profiles.

The demonstration shows:

- Regular fit.
- AI comparison rank.
- Semantic similarity.
- The combined score.
- Relevant explanation and evidence.

The sample comparison does not create actual applicants, offers, or hiring decisions.

### Data handling

AI keys remain on the server.

The comparison code does not separately add stored names, email addresses, or portfolio URLs to its comparison text. However, user-written briefs, biographies, and proposals can themselves contain personal information.

Review the displayed provider notice before sending text. The Gemini free-tier notice explains that submitted content may be used to improve Google products.

Do not include confidential information in demonstration requests.

---

## Matching and Trust

### Regular matching

The regular matcher uses signals such as:

- Required-skill coverage.
- Supported skill aliases.
- Project and proposal context.
- Self-reported experience.
- Available platform-recorded work evidence.

The interface distinguishes budget compatibility and availability from the fit score. These filters do not silently redefine the score.

### Trust evidence

Trust evidence is based on platform-recorded approvals and revisions.

Safeguards include:

- No invented trust score for freelancers without relevant history.
- Completed-work requirements for scored evidence.
- Limits on repeated revision influence.
- Limits on how much one client’s evidence contributes.
- Separation of self-reported portfolio samples from approved platform work.

These safeguards do not establish complete resistance to collusion or dishonest approvals.

### Cold-start support

A freelancer can use the platform without existing reviews.

Cold-start support includes:

- Guided profile setup.
- Preferred work fields.
- Profile-based project suggestions.
- Explainable matching.
- Portfolio samples shown separately from verified history.
- Client filtering for talent without approved platform work.

A new account is not automatically treated as a proven poor performer.

---

## Private Task Boards

The freelancer workspace includes a compact Jira-style planning system.

### Board columns

```text
To do → In progress → Review → Done
```

### Task fields

- Title.
- Description.
- Priority.
- Status.
- Optional due date.
- Optional milestone link.
- Checklist or subtasks.
- Optional reminder.
- Private activity history.

### Planning capabilities

- Create and edit tasks.
- Drag tasks between columns.
- Move tasks using keyboard controls or status selectors.
- Track checklist progress.
- Search task text.
- Filter by status, priority, and overdue state.
- View whole-board progress.
- Open task links directly.
- View daily tasks across active projects.
- Browse Today, Upcoming, Overdue, Open, and Done views.

### Privacy and persistence

Tasks and history are stored in MongoDB through the `ProjectTask` model.

They are separate from authentication sessions and public project records.

Only the eligible assigned freelancer can access their private project tasks. Clients, other applicants, and administrators do not receive access through task-board endpoints.

Completed and cancelled project boards are read-only.

### Reminders

Task reminders create in-app notifications.

They are not email messages, browser push notifications, or guaranteed exact-time alarms.

The backend checks reminders while running. A sleeping or offline service delivers eligible overdue reminders after it resumes.

### Important distinction

```text
Private task marked Done
        ≠
Milestone submitted
        ≠
Milestone approved by client
```

---

## Architecture

FreelanceChain uses a React frontend and a modular Express backend backed by MongoDB.

The cloud demonstration keeps browser API requests on the frontend’s own origin.

```text
User browser
    |
    v
Vercel
    |
    +-- React application
    |
    +-- /api reverse proxy
            |
            v
        Render
            |
            +-- Express application
            +-- Authentication and request checks
            +-- Project and milestone logic
            +-- Matching and AI integration
            +-- Reminder and optional email workers
            |
            +----------> MongoDB Atlas
            |
            +----------> Google Gemini or OpenAI
            |
            +----------> Brevo or another configured mail transport
```

### Why the API proxy matters

The browser accesses `/api` through the same frontend origin.

This supports the application’s cookie and CSRF design without relying on unrelated cross-site cookies between Vercel and Render domains.

A private shared proxy secret protects requests forwarded to the backend.

### Live updates

The application uses server-sent events for live updates.

The current event distribution is process-local. Running multiple backend instances would require a shared event transport.

---

## Technology Stack

| Area | Technologies |
|---|---|
| Frontend | React 19, React Router 6, CSS |
| Frontend tooling | Create React App and React Scripts |
| Backend | Node.js 24, Express 5 |
| Database | MongoDB and Mongoose |
| Authentication | Opaque cookie sessions and CSRF protection |
| Google sign-in | Google Identity Services and `google-auth-library` |
| Password hashing | bcrypt |
| File handling | Multer and private local or MongoDB storage |
| Live updates | Server-sent events |
| AI | Google Gemini or OpenAI |
| Email | Brevo HTTPS transport and other supported transports |
| Frontend hosting | Vercel |
| Backend hosting | Render |
| Cloud database | MongoDB Atlas |
| Testing | Node.js test runner, Jest, React Testing Library |

The lockfiles record the dependency versions used by the project. Install from those lockfiles rather than copying arbitrary versions from this table.

---

## Data Storage

MongoDB stores application records such as:

- Users and profiles.
- Projects and milestones.
- Applications and agreement history.
- Messages and notifications.
- Saved project drafts.
- Private tasks and task history.
- Sessions and request-limit records.
- Support and administrative records.
- Attachment metadata.
- Private attachment bytes when MongoDB storage is selected.

### Private uploads

The application supports:

- Private local storage for suitable installations.
- MongoDB-backed private storage for the cloud demonstration.

The deployed Render setup uses MongoDB-backed uploads so files do not depend on Render’s temporary local filesystem.

Files are accessed through authorized application routes rather than a public upload directory.

Upload sizes, file counts, and storage quotas are enforced. These controls do not replace malware scanning.

---

## Authentication and Security

### Password login

Users sign in with their email, password, and account type.

The browser receives an opaque HttpOnly session cookie. The application does not use browser-localStorage bearer tokens for authentication.

### Session behavior

- Session records are stored in MongoDB.
- Session token hashes are stored instead of raw cookie tokens.
- Production cookies use Secure and HttpOnly flags.
- Sessions have idle and absolute expiry limits.
- Reloading restores the session through the backend.
- Logout ends the current session.
- Global sign-out revokes the user’s existing sessions.
- Password changes, password resets, and confirmed email changes revoke sessions.

One browser profile shares its login across tabs. To keep two accounts open together, use separate browser profiles, separate browsers, or a private window.

### Google login and signup

Google Identity Services supports Client and Freelancer authentication.

The backend verifies the Google ID token and checks its audience, issuer, expiry, email verification, and nonce.

A short-lived, one-use challenge binds the response to the selected account type and sign-in mode.

Existing unverified email accounts cannot be silently linked through Google.

Google-only users can create a password through password recovery before using account actions that require current-password confirmation.

**Current deployment boundary:** Google OAuth remains in Testing mode. Only configured test accounts can use it until the remaining branding and publishing setup is completed.

### Other protections

- Role and project-participant authorization.
- CSRF checks on authenticated changes.
- Explicit allowed origins.
- Required application header for API writes.
- Shared MongoDB-backed request limits.
- Private/no-store API caching.
- Restricted file access.
- Version checks for stale edits.
- Security headers and content restrictions.
- Explicit confirmation workflows for sensitive account changes.

The current source preserves `no-referrer` on ordinary pages. The public login page uses an origin-only policy for Google sign-in.

These controls do not constitute an independent penetration test.

---

## Local Installation

### Requirements

- Git.
- Node.js 24.
- npm.
- A running local MongoDB instance or a dedicated development database.

Do not use the live demonstration database for local tests or experiments.

### 1. Clone the repository

```bash
git clone https://github.com/itzsonu/FreelanceChain.git
cd FreelanceChain
```

### 2. Install dependencies

Run from the repository root:

```bash
npm ci
npm --prefix backend ci
```

### 3. Create the backend configuration

Create `backend/.env` using `backend/.env.example` as the reference.

For a local application served by Express:

```env
MONGO_URI=mongodb://127.0.0.1:27017/freelancechain
JWT_SECRET=REPLACE_WITH_A_PRIVATE_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
APP_ORIGIN=http://localhost:5000
PORT=5000
EVENT_EMAILS_ENABLED=false
```

Replace the secret placeholder before starting.

Use a dedicated development database. Keep `.env` files private.

### 4. Build the frontend

```bash
npm run build
```

### 5. Start the application

```bash
npm --prefix backend start
```

Open:

```text
http://localhost:5000
```

Express serves the generated frontend build and the API.

### Frontend development

`npm start` runs the React development server.

When using a separate frontend development origin, configure the frontend API URL and backend origin allowlist consistently. Running the React development server alone does not start the backend or MongoDB.

Use the production-style local instructions above for the simplest single-origin setup.

---

## Environment Configuration

Never commit actual keys, passwords, connection credentials, or populated `.env` files.

### Core backend settings

| Variable | Purpose |
|---|---|
| `MONGO_URI` | Application database connection address |
| `MONGO_PASSWORD` | Optional separately stored database password for a username-only URI |
| `JWT_SECRET` | Stable private secret used for session-bound CSRF signing |
| `APP_ORIGIN` | Exact frontend origin |
| `PORT` | Backend listening port |
| `HOST` | Backend listening interface |
| `NODE_ENV` | Enables production configuration and cookie behavior |
| `CLIENT_ORIGIN` | Additional explicitly allowed frontend origins |
| `TRUST_PROXY` | Explicit trusted proxy addresses or subnets where required |

The legacy name `JWT_SECRET` remains in configuration, but browser authentication uses opaque sessions rather than bearer JWTs.

### Cloud storage and proxy settings

| Variable | Purpose |
|---|---|
| `PRIVATE_UPLOAD_BACKEND` | Selects `local` or `mongo` |
| `PRIVATE_UPLOAD_DIR` | Private local attachment directory when applicable |
| `UPLOAD_USER_QUOTA_MB` | Per-user attachment allowance |
| `UPLOAD_SHARED_QUOTA_MB` | Shared MongoDB attachment allowance |
| `FC_PROXY_SECRET` | Private shared origin-proxy secret |
| `FREELANCECHAIN_BACKEND_ORIGIN` | Vercel’s destination backend origin |

### AI settings

| Variable | Purpose |
|---|---|
| `AI_PROVIDER` | Selects `gemini` or `openai` |
| `GEMINI_API_KEY` | Private Gemini key |
| `OPENAI_API_KEY` | Private OpenAI key |
| `OPENAI_PLAN_MODEL` | Optional OpenAI planning-model override |

### Email settings

| Variable | Purpose |
|---|---|
| `RESET_DELIVERY` | Mail transport selection, such as `brevo` |
| `BREVO_API_KEY` | Private Brevo API key |
| `RESET_FROM_EMAIL` | Verified sender |
| `EVENT_EMAILS_ENABLED` | Enables optional project-event email delivery |

Password recovery and verification messages are separate from optional project-event alerts.

### Google sign-in

| Variable | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` | Public Web application OAuth client ID |

This integration does not require a Google client secret.

The authorized JavaScript origin must match the frontend origin.

Personal account ownership, recovery addresses, and private credentials belong in a separate private handover—not in a public README.

---

## Cloud Deployment

### Current application

```text
Frontend
https://freelancechain-demo.vercel.app

Backend
https://freelancechain-api-zje1.onrender.com
```

The backend API is intended to be used through the configured frontend proxy. Direct protected-origin requests may be rejected by design.

### Vercel

- Import the repository root.
- Use the project’s `vercel.mjs` configuration.
- Build with `npm run build`.
- Serve the `build` output directory.
- Configure `FREELANCECHAIN_BACKEND_ORIGIN`.
- Configure the same private `FC_PROXY_SECRET` used by the backend.
- Keep browser API requests on `/api`.

Do not place server secrets in `REACT_APP_` variables.

### Render

- Use `backend` as the service root.
- Install with `npm ci`.
- Start with `npm start`.
- Use `/api/health/ready` as the readiness endpoint.
- Set the exact production `APP_ORIGIN`.
- Configure private database and proxy settings.
- Use `PRIVATE_UPLOAD_BACKEND=mongo` for the deployed demonstration.
- Keep background-worker behavior in mind when choosing a hosting model.

### MongoDB Atlas

- Use a dedicated application database.
- Restrict the database user to the intended application.
- Configure appropriate network access for the backend.
- Keep temporary setup access separate from backend access.
- Store the connection credentials only in private server settings.

### Free-hosting behavior

The current demonstration uses a free Render service.

An idle service can sleep, so the first request after inactivity can take around a minute or longer.

The frontend provides service-starting feedback and bounded recovery. This does not make the backend permanently running.

Background reminders also depend on the backend being awake.

### Health endpoints

| Endpoint | Purpose |
|---|---|
| `/api/health/live` | Process liveness |
| `/api/health/ready` | Database and private-storage readiness |
| `/api/health` | Basic database connection status |

A visible frontend does not by itself prove that its database or backend is ready.

---

## Testing and Verification

Install dependencies and use a dedicated local test environment before running backend integration checks.

### Frontend tests

```bash
npm test -- --watchAll=false --runInBand
```

### Core backend workflows

```bash
npm --prefix backend run test:integration
npm --prefix backend run test:lifecycle
npm --prefix backend run test:changes
```

### Focused backend suites

```bash
npm --prefix backend run test:security
npm --prefix backend run test:drafts-emails
npm --prefix backend run test:storage-support
npm --prefix backend run test:recovery
```

### Hosting configuration

```bash
node --test deploy/hostingConfig.test.mjs
```

### Isolated launch workflow

```bash
npm --prefix backend run test:launch
```

The launch runner starts an isolated local MongoDB process when configured to do so. It requires a usable `mongod` binary or a suitable dedicated test instance.

Backend test databases use generated names. Never point test tooling at a production application database.

### AI configuration check

```bash
npm --prefix backend run ai:check
```

This reports configuration without making provider requests.

### Explicit live AI check

```bash
npm --prefix backend run ai:check -- --live
```

This makes external AI requests using synthetic text. It consumes the selected provider’s applicable quota or billing allowance.

Do not run it repeatedly without a reason.

### Verification already exercised

Development and live checks have covered areas including:

- Session restoration and role checks.
- Project drafts.
- Proposals and offers.
- Agreement acceptance.
- Milestone submissions and approvals.
- Revision handling and dependency unlocking.
- Private task-board behavior.
- Private attachment access.
- AI fallback and ranking behavior.
- Database/private-storage recovery in an isolated environment.
- Live deployment readiness.
- Existing Client Google sign-in in Chrome.

These are functional checks, not a claim that every possible production scenario has been tested.

---

## AI Accuracy Evaluation

### Functional correctness and matching quality are separate

A working AI request proves that the integration can return a result.

It does not prove that the ranking is accurate across real freelance projects.

### Current evaluation status

- Authored diagnostic matching cases are available.
- Synthetic trust-invariant checks are available.
- Independent-data collection templates are available.
- Evaluation tooling is implemented.
- No independently collected real matching dataset has been evaluated yet.
- No verified real-world accuracy percentage is claimed.

Earlier examples called “holdout” were available during development and must not be presented as independent research evidence.

### Available evaluation tools

```bash
npm --prefix backend run eval:matching
npm --prefix backend run eval:research
```

The research workflow supports:

- Top-one hit rate.
- Mean reciprocal rank.
- Recall at three.
- Binary NDCG at three.
- Tie analysis.
- Baseline comparisons.
- Category and history-group diagnostics.
- Dataset and source fingerprints.
- Development/holdout overlap checks.

See `research/PROTOCOL.md` for dataset requirements and command options.

### Evidence needed for meaningful evaluation

1. Obtain consented, anonymized project and applicant examples.
2. Have independent reviewers label applicant relevance without seeing AI ranks.
3. Resolve reviewer disagreements.
4. Separate development examples from held-out evaluation cases.
5. Compare the regular matcher, ablations, and AI comparison on the same cases.
6. Review errors, ties, subgroup coverage, and limitations.
7. Preserve the source snapshot, labels, dataset fingerprint, and report.

Synthetic demonstrations must remain clearly identified as synthetic.

---

## Important Application Routes

| Route | Purpose |
|---|---|
| `/` | Public home page |
| `/login` | Client/Freelancer login and signup |
| `/jobs/:projectId` | Public project brief |
| `/client-dashboard` | Client workspace |
| `/freelancer-dashboard` | Freelancer workspace |
| `/milestones/:projectId` | Shared milestone workspace |
| `/workrooms` | Project inbox |
| `/profile` | Freelancer profile |
| `/talent` | Client talent discovery |
| `/task-boards` | Private project boards |
| `/task-boards/:projectId` | Individual private board |
| `/my-tasks` | Tasks across active projects |
| `/account` | Account settings |
| `/forgot-password` | Password recovery |
| `/reset-password` | Explicit password reset |
| `/verify-email` | Current-email verification |
| `/account/verify-email` | Email-change confirmation |
| `/support` | Support |
| `/admin/login` | Administrator login |
| `/admin/overview` | Administrator overview |
| `/admin/cases` | Reported project cases |
| `/admin/support` | Support administration |
| `/admin/storage` | Storage administration |

Protected pages still enforce server authorization. Knowing a URL does not grant access.

---

## Repository Structure

```text
FreelanceChain/
├── backend/
│   ├── models/                 MongoDB models
│   ├── routes/                 API route handlers
│   ├── middleware/             Authentication and authorization
│   ├── scripts/                Setup, verification and recovery tools
│   ├── app.js                  Express application
│   ├── server.js               Startup, workers and graceful shutdown
│   ├── aiProvider.js           AI provider configuration
│   ├── aiPlanner.js            AI milestone generation
│   ├── semanticMatching.js     Embedding comparison
│   ├── scoring.js              Regular matching and trust
│   ├── sessions.js             Cookie sessions and CSRF support
│   ├── resetMail.js            Security-email delivery
│   ├── eventEmails.js          Optional event-email worker
│   └── researchEvaluation.js   Independent-data evaluation tooling
├── src/
│   ├── components/             Shared UI components
│   ├── pages/                  Application screens
│   ├── api.js                  API and session coordination
│   └── App.js                  Application routes
├── public/                     Public frontend assets
├── deploy/                     Hosting configuration and templates
├── research/                   Protocols, templates and synthetic examples
├── vercel.mjs                  Vercel configuration
├── Dockerfile                  Container build configuration
├── compose.yaml                Container deployment reference
├── package.json                Frontend dependencies and scripts
└── README.md
```

Private configuration, installed dependencies, generated builds, uploads, backups, and private research data are excluded from version control.

---

## Troubleshooting

### The frontend opens but the workspace does not load

Check the backend readiness endpoint and Render startup logs.

Possible causes include:

- A sleeping backend.
- Database authentication failure.
- Expired Atlas network access.
- Incorrect application origin.
- A proxy-secret mismatch.
- Invalid storage configuration.

Repeatedly redeploying without reading the failure reason will not fix an incorrect setting.

### MongoDB connection fails

Check:

- The application database name.
- The database username and permissions.
- Atlas network access.
- The saved password.
- Connection-string syntax.
- Whether the separate-password configuration is being used correctly.

When using `MONGO_PASSWORD`, keep `MONGO_URI` in the supported username-only format. Do not accidentally paste only a password into the URI field.

### Another tab changes the signed-in account

Tabs in one browser profile share the same session cookie.

Use a different browser profile, another browser, or a private window for simultaneous Client and Freelancer accounts.

### Google login is rejected

Check:

- `GOOGLE_CLIENT_ID`.
- Authorized JavaScript origin.
- Google OAuth audience and test users.
- The selected Client/Freelancer role.
- Whether the application account exists.
- Whether an existing password account has verified its email.
- Whether the Google account has an authoritative verified email supported by the flow.

A newly created Google client may also require configuration propagation time.

### Google’s chooser does not open in an embedded browser

Try the application in a normal browser such as Chrome.

The live Client Google sign-in flow was verified in Chrome. Embedded-browser behavior should not be treated as proof that the same authentication flow works everywhere.

### AI is unavailable or reports quota exhaustion

Check the configured provider, private key, project access, model availability, and quota.

Use regular comparison or guided planning while the external provider is unavailable.

Do not interpret a fallback result as successful AI execution.

### A task reminder arrives late

The reminder worker runs only while the backend is running.

A sleeping server catches up after resuming. Task reminders are not exact-time alarms.

### A saved edit reports a conflict

Another tab or request changed the record after it was loaded.

Refresh the current record, review the latest version, and reapply the intended edit. Do not overwrite it blindly.

---

## Current Limitations

- Real-world AI accuracy evaluation is incomplete.
- Google sign-in remains in Testing mode.
- Freelancer Google signup has not received the same live verification as the existing Client login.
- Password-reset arrival at the final real inbox still needs explicit confirmation.
- Optional project-event email alerts remain disabled in the deployed configuration.
- A production backup and live recovery rehearsal remain pending.
- Recovery tools have been checked using an isolated environment.
- Free-hosting cold starts remain possible.
- Background workers pause while the backend is asleep.
- Live event distribution is currently process-local.
- Independent penetration testing is not claimed.
- Malware scanning is not implemented.
- Actual account erasure requires administrative handling.
- Payments, escrow, refunds, and blockchain transactions are not implemented.

The deployed application should be presented as a functional project demonstration with documented production boundaries.

---

## Future Work

### Before broader public use

- Complete Google branding and publishing.
- Confirm password recovery at a real inbox.
- Establish private backup storage and a recovery schedule.
- Perform a controlled production recovery rehearsal.
- Configure operational monitoring and alerts.
- Review privacy, retention, support, and deletion procedures.
- Complete an independent security review.
- Review upload scanning and abuse controls.

### AI and research

- Collect independently labelled relevance data.
- Complete held-out evaluation.
- Review performance across project categories.
- Analyze cold-start behavior and score ties.
- Document false matches and limitations.
- Tune matching only against appropriate development data.

### Scaling

- Add shared live-event distribution.
- Review worker scheduling for the selected hosting model.
- Measure database queries and storage growth.
- Review limits against actual usage.
- Improve background processing and observability where required.

---

## Documentation

| Document | Purpose |
|---|---|
| [AI_SETUP.md](AI_SETUP.md) | AI setup, fallback and sample comparison |
| [MATCHING_EVALUATION.md](MATCHING_EVALUATION.md) | Matching evaluation background |
| [research/PROTOCOL.md](research/PROTOCOL.md) | Independent-data evaluation protocol |
| [COLD_START.md](COLD_START.md) | New-freelancer support |
| [TASK_BOARDS.md](TASK_BOARDS.md) | Private boards, tasks and reminders |
| [SECURITY_SETUP.md](SECURITY_SETUP.md) | Session, CSRF and request protection |
| [EMAIL_SETUP.md](EMAIL_SETUP.md) | Email transport and event alerts |
| [STORAGE_SUPPORT.md](STORAGE_SUPPORT.md) | Storage, support and deletion review |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deployment and recovery tooling |
| [CLOUD_HOSTING.md](CLOUD_HOSTING.md) | Vercel, Render and Atlas architecture |
| [deploy/GOOGLE_SIGN_IN.md](deploy/GOOGLE_SIGN_IN.md) | Google authentication setup |
| [DEMO_GUIDE.md](DEMO_GUIDE.md) | Demonstration guidance |

Some supporting documents describe earlier implementation checkpoints. Their historical “pending” or “not configured” statements may differ from this snapshot.

Use the current source, saved configuration, and latest verified deployment evidence when maintaining the application.

---

## Maintainer

GitHub: [itzsonu](https://github.com/itzsonu)

Repository: [FreelanceChain](https://github.com/itzsonu/FreelanceChain)

For issues or suggestions, use the repository’s Issues section. Never include passwords, API keys, session cookies, private connection strings, or personal project data in a public issue.
