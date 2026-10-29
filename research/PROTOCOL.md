# Phase 3: independent matching evaluation

The evaluation tools and collection templates are ready. No independently collected dataset exists yet. The shipped example is fictional and must not be used as an accuracy or fairness result. Do not relabel development examples as independent holdout evidence.

## Questions and frozen comparisons

Compare the existing production matcher with (1) skill coverage alone, (2) its base score with context removed and (3) the matcher with trust removed. These are paired comparisons on the same labelled projects. The scripts do not change production scores or weights.

Use project relevance labels, not hiring decisions or assumed successful delivery, as the target. Assess whether the ranked applicants' documented skills and proposed work fit the brief. Keep milestone planning quality and delivery outcomes as separate questions; matching metrics cannot validate them.

The report saves SHA-256 fingerprints of the dataset and scoring/evaluation source. Freeze the implementation before collecting/evaluating the holdout. Preserve the report, original dataset and source snapshot together. Exact duplicate cases and project groups are rejected; `--development` also checks overlap by case token, group token and normalised project brief/skills. Manually check near duplicates, related sources and repeated applicants. The script cannot prove source independence from flags alone.

## Collect and anonymise cases

1. Obtain permission to use the brief, applicant text and any prior platform history for research. Keep private consent evidence outside the distributable dataset. `consent-log.template.csv` uses opaque record/group references; do not add participant names, addresses or contact details to the dataset.
2. Use one independently sourced project per case and assign random opaque `case-`, `group-`, `candidate-` and `client-` tokens. Keep the same client token across a candidate's prior projects so the cap remains meaningful. Do not assign IDs based on label quality; IDs break tied scores.
3. Include the brief, reviewed required skills, category and two to twenty plausible candidates. Prefer at least three applicants for useful top-three comparisons. Preserve difficult matches and poor-fit proposals; do not curate only obvious successes. Record a selected custom field in the brief for Other projects.
4. Remove identifying information from all free text. The validator blocks known identifier fields and obvious email/phone/URL/address patterns; a human must check remaining names and sensitive details.
5. If prior platform data is available, add `history` with `recordedBeforeCase: true` and bounded prior projects/milestones. Use only approvals and revisions recorded before the evaluated case. Empty verified `projects: []` means no approved platform history. Omit `history` when the snapshot is unavailable; it will be reported separately as missing, not assumed new.
6. Keep development cases separate from holdout at the source-group level before looking at model results. Do not tune weights or edit relevance labels after viewing holdout failures. Additional iterations need a new untouched holdout.

`dataset.template.json` starts with false declarations and no cases. It intentionally fails evaluation until collection and labelling are completed. Copy record structure from the fictional `case-example.synthetic.json`, not its content or relevance labels. Set provenance declarations only when supported by actual evidence. The evaluator checks declarations and structure; it does not independently verify consent or reviewer participation.

## Independent relevance labelling

Have two reviewers assess each applicant independently, without seeing any model scores, algorithm rankings or the other reviewer's answers. Show project/profile/proposal content in a random order. Keep trust history hidden during skill/context relevance labelling so the target is not constructed from the model's trust formula.

Use `reviewer-labels.template.csv`, with one row per candidate per reviewer:

- `relevance = 1`: documented skills and proposed deliverables fit the brief sufficiently for a client shortlist.
- `relevance = 0`: material skill or scope mismatch makes the candidate unsuitable for that shortlist.
- `relevance = uncertain`: the available evidence is insufficient; request clarification or adjudicate before inclusion.
- `reason`: a brief explanation grounded in the visible brief, skills or proposal; no model score or personal identifier.
- `rubricVersion`: `relevance-v1` for this rubric. Use random opaque reviewer tokens.

Retain both original labels and reasons. Resolve disagreements through a documented adjudication; do not silently replace them. Record the disagreement count and any exclusions in the final study. Do not force a positive label on a case where nobody is relevant. The current positive-relevance ranking metrics require at least one relevant candidate, so report such excluded cases separately as a limitation.

Only after finalising labels, populate each case's `relevantApplicantIds`. `reviewerCount`, `independentLabels` and `scoresHiddenDuringLabelling` describe real participation and process, not settings that manufacture research evidence.

`experienceGroup` is optional: define `new` as 0–1 self-reported years and `experienced` as 2+ years before collection. Missing labels remain missing. This is different from platform cold start: a professional with four years' experience and no approved platform milestones belongs to the experienced group and the no-history group.

## Run the tools

From the source workspace's `backend` folder:

```text
npm run eval:research
npm run eval:research -- --dataset ../research/case-example.synthetic.json
npm run eval:research -- --dataset path/to/holdout.json --development path/to/development.json --report path/to/new-report.json
```

The first command reports readiness and six synthetic trust invariants; it evaluates zero real cases. The second checks the fictional one-case format and reports insufficient data for percentages. The third evaluates the supplied data and writes an aggregate JSON report. Existing reports and input datasets are not overwritten. No MongoDB connection, user export, email or external request occurs by default.

Live Gemini milestone planning and applicant comparison were demonstrated earlier in this project. That integration evidence does not establish real-world accuracy: an independently labelled holdout comparison remains pending. For the optional research run, use separately recorded external-processing permission, the configured provider's private key and an explicit case budget:

```text
npm run eval:research -- --dataset path/to/holdout.json --ai --ai-max-cases 10 --report path/to/new-ai-report.json
```

By default, AI permits at most ten cases and one embedding request per case. A larger dataset exceeds this budget without sending anything; increase the limit explicitly only if intended. It stops AI processing after the first service failure, makes no paid retries and suppresses partial AI metrics while preserving the full offline report. All baseline comparisons use the same data. Full candidate text is sent only for an authorised explicit AI run; do not include personal information.

## Interpret results

- Top-one hit rate counts projects whose first-ranked applicant is labelled relevant. Mean reciprocal rank averages the reciprocal position of the first relevant applicant.
- Recall@3 measures relevant applicants retrieved within the first three; binary NDCG@3 rewards placing relevant applicants earlier. Reports identify cases with fewer than three candidates, where recall@3 can be trivial.
- Metrics are averaged per project. Groups with fewer than five cases, missing labels or mixed relevant-applicant groups do not receive subgroup rates. Five is a display threshold, not proof of an adequate sample or a statistical power calculation.
- Inspect score ties and the tie-neutral top-one rate. The normal deterministic applicant-ID tie-break must not be mistaken for meaningful relevance discrimination.
- The 95% Wilson top-one interval is descriptive and assumes independent project cases. It does not correct for correlated clients, annotator uncertainty, sampling bias or repeated applicants. Paired win/loss counts are descriptive; no significance claim is made.
- Inspect category and relevant-applicant history/experience splits, plus selected-applicant history counts. These are diagnostic comparisons, not proof of fairness. Retain false-match examples privately and summarise common failure reasons without identifiers in the final report.
- Six trust invariant checks exercise no-history handling, approved-work-only scoring, revision caps and per-client caps. They do not validate resistance to fake approvals, related client accounts or collusion.

Ranking metric definitions follow Stanford's [Introduction to Information Retrieval](https://nlp.stanford.edu/IR-book/html/htmledition/evaluation-of-ranked-retrieval-results-1.html). The top-one interval follows the [NIST Wilson interval description](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm).

## Evidence required to finish research

Retain real consent references, anonymisation review, independent reviewer sheets, adjudications, split decisions, source/data fingerprints, complete aggregate reports and a limitations/error analysis. Document recruitment and exclusion counts. Review actual sample size and sampling design with the supervisor before making general claims. Live AI comparison additionally requires the private key and successful Phase 2 activation checks. Until this evidence exists, describe Phase 3 as tooling ready and real-data evaluation pending.
