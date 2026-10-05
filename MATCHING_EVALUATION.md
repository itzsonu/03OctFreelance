# Phase 10: matching and trust evaluation

## What is implemented

- The regular shortlist uses listed skill names, self-reported experience, and platform-recorded approvals/revisions. It works without an AI service.
- A client can explicitly request AI-assisted comparison while a project is open. The server sends the project title, brief and skills plus each pending applicant's listed skills, headline, experience, bio and proposal to OpenAI's embedding API. It does not separately send names, email addresses or portfolio URLs. User-authored text can still contain personal details.
- The result combines cosine text similarity (60%) with the regular fit estimate (40%). It shows both components and verified-work evidence. The combined score is an **ordering aid**, not a probability of successful delivery or a hiring recommendation. The client still makes the decision.
- AI vectors and rankings are not stored in MongoDB. With no API key, only the regular shortlist is available.

## Checks completed

- Trust tests cover new freelancers without history, completed-work-only scoring, and the rule that repeated revision requests on one milestone count once in the score.
- The real MongoDB integration test checks that only the project client can request AI analysis, that no AI request occurs without configuration, and that returned scores correspond to the intended application.
- A mocked embedding response verifies ranking math, input ordering, invalid-vector handling, and exclusion of separately stored names, email addresses and portfolio URLs.
- `npm run eval:matching` runs six **fictional, hand-labelled diagnostic cases**. The regular shortlist ranks the expected applicant first in **4 of 6** cases. The two misses involve equivalent framework wording and project context that exact skill matching cannot capture. This is a small smoke check, **not** an estimate of real-world accuracy or fairness.

## What remains before a research claim

The actual embedding service has not been called because no API key is configured. Run `node matchingEvaluation.js --ai` with a private `OPENAI_API_KEY` to compare it on the fictional cases. Before claiming improved matching, collect consented, anonymized project/application relevance labels; compare against the regular shortlist on held-out data; inspect results by new versus experienced freelancers and skill category; and document false positives, fairness concerns and cost. No real hiring outcomes have been evaluated yet.

The trust formula also lacks real-world validation against collusion or dishonest approvals. Its revision cap and completed-work requirement limit two simple forms of manipulation, but they do not prove fraud resistance. A scaled deployment should move the current per-process AI request cooldown to shared rate limiting.
