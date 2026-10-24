# Skill suggestions and optional AI setup

## What works without a key

In New Project, choose the category (and field for Other), enter a brief of at least 30 characters, then choose **Suggest skills from brief**. Suggestions show the words found in the brief. Choose individual skills to add them; manual entries stay editable. At most ten required skills are accepted. The bounded English catalogue normalises named tools and common work terms, filters them by field, and avoids common explicit exclusions. It can miss unfamiliar skills or complex language; a client must review the list. This is deterministic extraction, not a trained NLP model or measured research accuracy.

**Suggest a plan** gives a category-aware guided draft without any external API call. Review and apply a draft explicitly, then edit its milestones, dependencies, amounts and target dates. Regular applicant fit scores, trust evidence and shortlisting work without AI.

## Activate the optional AI features

1. Put `OPENAI_API_KEY` privately in `backend/.env`. Keep it on the backend; never use a `REACT_APP_` key or commit/paste the secret.
2. Restart the backend. A configured key enables the two AI buttons; it does not prove that billing, permissions or service access work.
3. From the `backend` directory, run `npm run ai:check`. This prints configuration status and makes **no API calls**.
4. When ready to make two real API requests with synthetic text, run `npm run ai:check -- --live`. It checks one milestone draft and one comparison, uses no database/user records, has no automatic retries, and reports the two results separately. API usage follows your OpenAI account's billing. A failed live check exits with a nonzero status.

Milestone drafting uses the existing `gpt-4o-mini` default, or `OPENAI_PLAN_MODEL` if set, via the Responses API with strict structured output and `store: false`. Applicant comparison uses `text-embedding-3-small`; it blends 60% cosine text similarity with 40% regular explained fit. Neither score predicts hiring success. See the official [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses) and [Embeddings guide](https://developers.openai.com/api/docs/guides/embeddings).

## Review and fallback behaviour

- **Draft with AI** sends the entered project title, field, brief, skills, budget and deadline only on click. An unusable response leaves the entered milestones intact and offers **Use guided fallback**. The replacement preview is labelled **Guided draft** and is applied only after client confirmation.
- **Compare with AI** sends project and pending applicant profile/proposal text only on click, up to 20 candidates. Free text may contain personal information. The UI explains this before sending. Service failures preserve regular comparison and hiring controls. Applicant, shortlist and offer changes discard old AI rankings, including responses still in flight.
- AI requests in the application are limited to one draft per client and one comparison per client/project per minute. No automatic paid retries are made. The separate live checker should be run only when verification is needed.
- For missing credentials, billing/model restrictions, timeout or malformed output, use guided planning and regular comparison. Failed model output is never published automatically.

## Completion boundary

Phase 1 implementation is skill extraction with editable, evidence-backed client review. Phase 2 implementation supplies optional AI flows, validation, fallback and a safe activation checker. Live AI activation remains unverified until a real key is configured and both live checks pass. Mocked tests verify integration behaviour; they do not establish live model quality. Independent dataset evaluation and the final capstone evidence remain later phases.


## Three-applicant sample demo

On the Client dashboard, open **Open sample demo**, review the fictional writing brief and three authored profiles, then choose **Compare sample profiles with AI**. Opening the samples uses regular scoring only; comparing makes one embedding batch for the brief plus all three profiles. The panel shows AI rank, text similarity, regular fit and the 60/40 calculation. Real applicants and the client's project text are not sent by this sample demo. No users, applications, work history or offers are created.

The sample result is cached in server memory for 10 minutes and concurrent requests share the same batch. Failed requests have a one-minute cooldown. Restarting the service clears this cache. Missing credentials, provider quota failures and invalid output leave regular scores available without fabricating an AI result or switching providers. Google free-tier disclosure remains visible. These authored samples demonstrate behavior; they do not establish real-world accuracy.

Focused workflow check: run **npm run test:launch** in backend. It starts an isolated local MongoDB, creates only a randomly named test database and drops that database afterward. Requires mongod (or FC_TEST_MONGOD pointing to its executable); TEST_MONGO_BASE can point to an existing local test instance. It covers proposal withdrawal/offer decline, stale acceptance, revision history, stale submission review, dependency unlocking and participant authorization. No hosted database or real users are used.
