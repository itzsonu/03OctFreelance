# Cold-start support: phases 1 and 2

New freelancers can build a starting profile and discover relevant open work without previous clients or approved milestones. This is content-based cold-start support, not evidence that real hiring outcomes or fairness have been validated.

## Guided setup

The profile page shows a checklist based on saved details: introduction, skills, preferred work fields and availability. Portfolio/practice samples are optional and do not prevent profile saving or applying. Zero self-reported years of experience is valid. Samples are labelled separately from platform-approved work. Visibility in client talent search remains explicit opt-in; completing the checklist does not turn it on.

Preferred categories are validated and stored on the existing profile. Older clients omitting the new field retain saved preferences. No existing user profiles, uploaded files or work history were reset or backfilled. A failed profile load cannot expose an empty replacement form for saving.

## Project suggestions

`GET /api/projects/recommended` is private to the signed-in freelancer. It uses saved skills and preferred categories, with the same skill aliases as regular applicant matching. No trust score, reviews, completed-project count, experience-years weight, AI request or training dataset is used.

Projects with a skill overlap come first, ordered by required-skill coverage and matched-skill count, with preferred field and recency as later tie-breaks. Preferred-field-only suggestions follow with an explicit request to review skills. This does not provide semantic matching or guarantee suitability. Missing both skills and preferences produces setup guidance, not a manufactured personalised list; ordinary project browsing remains available.

Ranking and pagination operate across eligible database records before a page is selected. Closed, hidden, assigned, past-deadline and suspended-owner listings are excluded, as are projects the freelancer has already applied to. Cards explain the actual shared skills/preferred field and open the full brief before a proposal can be sent. Profile editing and marketplace/application events refresh suggestions. Out-of-range pages recover to the last available page.

## New talent discovery

Client talent search supports `history=none` (no approved platform milestones) and `history=recorded` (at least one approved platform milestone). This is independent of self-reported years of experience: an experienced person may still be new to the platform. Skill filters understand the existing aliases. Visibility consent and suspension rules still apply; history filtering happens before count/pagination. Users are not assigned invented trust or automatically shortlisted/hired.

First approved work removes a freelancer from the no-history filter and starts the existing evidence-based trust calculation. It does not change the content-based project recommendation algorithm.

## Verification and remaining phase 3

Focused disposable-database checks cover saved preferences, legacy preservation, input/role restrictions, no-history recommendations, global ranking/pagination, aliases, hidden/closed/expired/suspended listings, existing applications, consented talent visibility and first-approval transitions. Frontend coverage includes setup/save, recommendation explanations/retry/opening and history filters. These checks are functional examples, not a real-world accuracy or fairness result.

Phase 3 remains broader pilot-user feedback and independent, consented relevance evaluation. See `research/PROTOCOL.md` for evidence requirements. No research result, public deployment, email activation, API key or independent dataset was created by this batch.
