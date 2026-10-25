# Google sign-in / sign-up

Use Google Auth Platform in the existing project. Create branding for FreelanceChain, External audience, and basic profile/email access only. Use the project owner's support/contact inbox. The owner must approve Google policies and credential creation. No billing or Google client secret is required by this flow.

Create a Web application OAuth client with Authorized JavaScript origin https://freelancechain-demo.vercel.app (and http://localhost:5001 only when needed for local development). GIS uses a JavaScript callback, so no redirect URI is required. Set the public client ID in the backend as GOOGLE_CLIENT_ID and redeploy. Do not enter a client secret. For testing audience, add intended test accounts in Google Console. For public sign-in, review Google's production publishing requirements.

The app fetches public configuration; when absent the Google control stays hidden and password login remains available. A five-minute HttpOnly nonce cookie and hashed, one-use database challenge bind each Google ID token to the chosen Client/Freelancer role and signup/signin mode. Google auth library verifies signed tokens and audience; no Google tokens are stored. Existing verified password accounts can link their authoritative Gmail/Workspace identity. Unverified email collisions require password login and inbox verification first. Admin and suspended accounts cannot use this flow.

Google-only users can use Forgot password to create a password before password-protected account changes. Ephemeral Google login challenges are excluded from backups and must never be restored.
