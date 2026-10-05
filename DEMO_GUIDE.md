# FreelanceChain capstone demo

This demo uses a **separate local MongoDB database** named `freelancechain_demo`. The sample projects and accounts are fictional. Do not use the demo accounts or seed command on a public deployment.

## Start the demo on Windows

1. Start MongoDB on `127.0.0.1:27017`.
2. In the project root, run `npm ci` and `npm run build`.
3. In `backend`, run `npm ci` and `npm run demo:seed`. Note the password printed by the script. To choose your own local password, set `$env:DEMO_PASSWORD='your-12-plus-character-password'` before seeding.
4. In the same PowerShell terminal, set:

   ```powershell
   $env:MONGO_URI='mongodb://127.0.0.1:27017/freelancechain_demo'
   $env:JWT_SECRET=[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
   $env:NODE_ENV='production'
   $env:APP_ORIGIN='http://127.0.0.1:5000'
   $env:RESET_DELIVERY='console'
   $env:PORT='5000'
   npm start
   ```

5. Open `http://127.0.0.1:5000`. The API health check is at `http://127.0.0.1:5000/api/health`.

The three sample accounts use the same password printed by the seed command:

| Role | Email |
| --- | --- |
| Client | `demo.client@freelancechain.local` |
| Experienced freelancer | `demo.freelancer@freelancechain.local` |
| New freelancer | `demo.new@freelancechain.local` |

## Five-minute presentation path

1. **Client workspace:** Log in as the client. Show the three projects, the **Project pulse** card, and the new **Delivery outlook**. The active sample project has too few approvals for a finish-date estimate; the screen says so and suggests reviewing its submitted work. Open **New project**, enter a brief, skills and budget, then preview **Suggest a plan**. Apply the draft and show that every step can still be edited before publishing. The optional **Draft with AI** button stays disabled in the default demo without a backend key; when configured, the client must click it and review its separate preview. Close the form to keep the sample data unchanged.
2. **Explainable shortlist:** Open **Applicants** for `[DEMO] New booking dashboard`. Compare Riya's matched skills and verified work with Dev's new-account status. Explain that the fit estimate is a transparent rule-based aid and the client makes the decision.
   The **Optional AI-assisted comparison** panel explains data sharing. In the default local demo, it is disabled because no API key is set; the regular shortlist remains functional. If configured, the client must actively choose **Compare with AI**.
3. **Milestone review:** Open `[DEMO] Client portal redesign`. The first milestone is submitted. Show its prerequisite, submitted work, and activity history. Request a revision with specific feedback.
4. **Freelancer response:** Sign out and log in as Riya. Open **My projects**, then the redesign project. Show the feedback, submit revised work, and inspect submission history.
5. **Approval:** Sign back in as the client. Approve the revised work. The second milestone unlocks and the activity history records the action.
   With the project open in a second signed-in browser session, the freelancer's milestone page updates after that approval without a manual reload. The client and freelancer dashboards also show a **Live updates** indicator while connected.
6. **Trust:** Sign in as Riya and open **Edit my profile**. Show the Trust Score and its approved milestone/revision evidence.
7. **Password recovery:** From the login screen, choose **Forgot password?** and enter a sample account email. Copy the one-time link printed in the backend terminal, open it, and set a new password. Reseed afterward if you want the original demo password restored.

To send a real reset email from your Gmail account instead of using the local terminal, follow [EMAIL_SETUP.md](EMAIL_SETUP.md). The sample accounts end in `.local`, so create an account using an inbox you own before testing email delivery. Never put a Gmail App Password into the browser or chat.

For an unchanged demo on every run, reseed before the presentation. Reseeding replaces the three sample projects and sample account passwords within `freelancechain_demo` only.

## What to say accurately

- Milestone amounts are planning figures; there is no real payment processing or escrow.
- The regular shortlist is rule-based. Optional embedding comparison uses a pretrained model when configured, but its fit score has not been validated as a hiring-outcome prediction.
- Optional embedding comparison is implemented but has not been run against a live model or real hiring labels in the default demo. See `MATCHING_EVALUATION.md` for its limits.
- Trust uses platform-recorded approvals and revisions. At most three approval-equivalents from one client account affect the score, and the UI shows both raw and counted approvals. This limits one-account milestone inflation; it is not identity verification or a guarantee of performance.
- Project pulse is a rule-based summary of deadline, review and revision status, not an AI prediction.
- Delivery outlook estimates a finish date only after two approvals at least a day apart. It uses observed pace and flags repeated revisions or inactivity. It is a rough planning aid, not a trained risk model or a probability of failure.
- Live updates use an authenticated event stream on the local backend. The browser fetches the current data after each signal and reconnects if the stream drops. A multi-server public deployment would need shared pub/sub.
- The default local demo prints password-reset links in the backend terminal. Gmail delivery is available for a small local demo after configuring an App Password. Public delivery needs a reachable HTTPS frontend and a suitable sender service.
- Expired sessions return to login with an explanation. Repeated login and signup attempts are rate limited per server instance.
- The milestone draft uses fixed templates and keyword signals. It is optional, editable, and does not publish or save a project by itself.
- Optional AI milestone drafting is separately opt-in, sends the project fields shown beside the button to OpenAI, and returns a checked editable preview. It has been tested with a mocked service, not a live API key in this demo.
- A live public deployment needs a hosting target and MongoDB connection. The local demo and production build are ready to run.
