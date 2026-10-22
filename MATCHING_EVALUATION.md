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
- `npm run eval:matching` runs **fictional, hand-labelled diagnostic cases**. The earlier Phase 10 checkpoint recorded 4 of 6 diagnostic matches. After the subsequent alias/context changes, the 8 October 2026 check gives 6 of 6 diagnostic matches and 4 of 4 legacy examples named holdout. Those examples were available during development and are not an independent research holdout. These are smoke checks, **not** estimates of real-world accuracy or fairness.

## What remains before a research claim

The actual embedding service has not been called because no API key is configured. Run `node matchingEvaluation.js --ai` with a private `OPENAI_API_KEY` to compare it on the fictional cases. Before claiming improved matching, collect consented, anonymized project/application relevance labels; compare against the regular shortlist on held-out data; inspect results by new versus experienced freelancers and skill category; and document false positives, fairness concerns and cost. No real hiring outcomes have been evaluated yet.

The trust formula also lacks real-world validation against collusion or dishonest approvals. Its revision cap and completed-work requirement limit two simple forms of manipulation, but they do not prove fraud resistance. A scaled deployment should move the current per-process AI request cooldown to shared rate limiting.

## New Phase 3 research tools

Use [research/PROTOCOL.md](research/PROTOCOL.md) and `npm run eval:research` for the new independent-data workflow. Schema v2 records provenance declarations, blinded labelling and prior platform-history snapshots; reports compare skill-only, no-context, no-trust and current matching, expose score ties and suppress small or unlabelled subgroup rates. It rejects duplicate project content and can check development/holdout overlap. The collection template is empty and unconsented until real evidence exists; the example file is explicitly synthetic. No independently collected dataset is available yet. The research tooling does not change production ranking or assert research completion.
