# Cold-start phase 3: pilot collection plan

Status: collection materials and functional flow are ready. No human pilot has been run and no real relevance, hiring-outcome or fairness result is reported here.

## What to observe

Recruit consenting participants from three starting situations: a freelancer beginning their career, an experienced freelancer with no approved platform work, and a client looking for talent. Record actual recruitment counts and exclusions; these roles are not a representative sample by themselves. Agree the pilot size with the project supervisor before recruitment. Participation is voluntary and withdrawal must be possible.

Use disposable accounts and fictional project briefs for usability sessions. Do not ask for passwords, private client work, contact details or payment information in feedback. An observer may record task completion, requests for help and the participant's own comments after consent. Keep consent records and any identity mapping privately outside Git, separately from observations. Use opaque session references in `cold-start-feedback.template.csv`. Do not commit completed sheets, recordings or screenshots with real user information.

For each actual participant, record the app commit, date, browser, viewport and starting profile situation. Try phone widths of 360 and 390 pixels and a desktop width of 1280 pixels; record any untested combination as untested. Simulated browser checks are functional checks, not pilot participants.

## Tasks

| Task | Expected observable behavior |
| --- | --- |
| Create a starting freelancer profile | Zero experience and no portfolio sample are allowed. The saved setup guide explains missing essentials. Talent visibility stays off unless the participant chooses it. |
| Follow setup, preference and availability links | The corresponding editable field receives focus after the profile loads. Returning to projects uses the saved details. |
| Save and retry after a connection failure | Saving locks the form. A failed save keeps the draft, shows a visible error and allows retry. Do not reload a draft while checking this. |
| Inspect suggested projects | The participant can explain the shared skills or preferred field, inspect the complete brief and distinguish a suggestion from guaranteed suitability. |
| Open a brief on a slow connection | Loading is visible. Cancel or leaving the tab prevents a late brief from opening. Failure offers a retry. |
| Explore an empty or incomplete match | Setup or empty guidance remains useful and ordinary project browsing is reachable. An unavailable freelancer sees the availability link. |
| Send a fictional proposal | The full brief precedes the proposal form. A sent proposal appears under My applications; it does not claim the freelancer is hired. |
| Find talent as a client | The no-approved-work filter can show consenting, discoverable freelancers regardless of self-reported experience. No score is not presented as poor work. |
| Share feedback | The link opens Support with an editable subject and an empty message. Nothing is submitted until the participant submits. Replies remain in Support; this does not activate email. |

Record `completed`, `needed_help`, `blocked` or `skipped` for each task, plus the concrete confusion or failure. Leave missing observations blank. Summarise issues by task, severity and affected viewport; retain contradictory comments rather than replacing them with invented averages. Fix blocking defects and rerun only affected tasks. Report the true sample size and remaining limitations.

## Independent project relevance review

Usability feedback is not an accuracy label. The existing `PROTOCOL.md` and evaluation runner assess applicant matching; they do not validate freelancer-to-project recommendations.

For a later recommendation study, obtain permission for the anonymised profile skills/preferences and project brief snapshots. Freeze the app commit, candidate project pool, eligibility date, algorithm and development/holdout split before inspecting holdout labels. Keep related people/projects in one split. Give independent reviewers the task requirements and anonymised profile information, with rankings, recommendation reasons, platform scores and other reviewers' labels hidden. Use `cold-start-relevance.template.csv` to record relevant, not_relevant or uncertain with a reason. Keep uncertain and missing judgements distinct. Adjudicate disagreements without changing original reviewer sheets.

Include relevant projects outside the displayed top suggestions so missed relevant work can be measured. Later compute ranking measures only from a sufficiently judged eligible pool and a declared protocol; do not infer recall from top results alone. Record coverage, uncertainty, disagreement and known missing labels. Define any group comparison in advance, distinguishing career experience from approved platform history. Small or unbalanced groups cannot support a general fairness claim.

The two CSV files are empty collection templates, not datasets or measured results. No additional model training or OpenAI key is required for the current content-based recommendations. Human participation and independent labels are required to complete this validation work.
