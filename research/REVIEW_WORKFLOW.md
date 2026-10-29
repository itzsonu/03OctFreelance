# Blinded review and label import

This offline workflow connects the collection templates to the existing ranking
evaluator. It does not collect consent, recruit reviewers or prove real-world
accuracy. It never connects to MongoDB, loads .env, sends email or calls an AI
provider. Source and human evidence remain the coordinator's responsibility.

## Collect first

Copy collection.template.json into a private directory outside the repository.
It starts empty and deliberately fails validation. Add independently sourced,
consented/anonymized project cases using the project/profile/proposal/history
structure documented in PROTOCOL.md and case-example.synthetic.json. Do not
copy the example's fictional content, relevance labels or source declarations
into an independent-data claim.

Each collection case has caseId, groupToken, split, project and candidates.
Choose development or holdout BEFORE reviewing labels or model results. Keep
one case per independent source project group. There is no relevance field yet.
Use random opaque identifiers; do not include names, contact details or URLs.
Keep actual consent records and reviewer identities separately and privately.
Set truthful source declarations; flags cannot manufacture evidence.

## Create the reviewer packets

From backend, the command is:

~~~text
node reviewWorkflow.js pack --source C:/PRIVATE/collection.json --out C:/PRIVATE/NEW-STUDY
~~~

On Windows, use the repository's portable launcher (from backend):

~~~powershell
& .\scripts\reviewStudy.ps1 -Action pack -Source C:\PRIVATE\collection.json
~~~

It first restricts the private study root to the owner and SYSTEM. The default
root is %LOCALAPPDATA%\FreelanceChain\AI-Studies; -PrivateRoot selects another
dedicated private directory outside the repository. -NodePath can select an
installed node.exe when node is absent from PATH. -OutputName selects a NEW
child folder. Use the same launcher with -Action merge and -Packet, -ReviewerA,
-ReviewerB, -Evidence and optional -Adjudications for the merge command below.
This workspace also supplies Run-AI-Review-Workflow.ps1 as a convenience wrapper.
Existing output directories are not overwritten.

Give reviewer A ONLY reviewer-A/ and reviewer B ONLY reviewer-B/. They open
review.html in their browser, choose relevant/not relevant/uncertain, give a
reason and download their completed CSV. labels.csv is a blank spreadsheet
alternative. Do not mix the two reviewers' files or complete their answers
for them. The HTML sends no network requests or browser-storage writes.
Unsaved answers are lost when the page closes.

Project and candidate order are independently randomized for each reviewer.
The forms contain no model scores, target relevance labels, source split/group
metadata or platform approval history. This does not prevent reviewers from
communicating; the coordinator must preserve actual blinding/independence.

Keep coordinator.json, the original source, consent records, implementation
snapshot and evidence.template.json private from reviewers. The packet locks
source/scoring/evaluation/import implementation hashes. If code changes,
review the impact and create a new frozen study rather than silently reusing
the old packet. Repeated candidates, near-duplicate sources and source-group
relationships still need human checking beyond structural validation.

## Resolve uncertainty and import

Retain both original completed CSVs. For every disagreement or uncertain pair,
write one human decision and grounded reason in a copy of
adjudications.template.csv. Both-uncertain pairs also need adjudication. The
importer rejects missing, duplicate, unknown, blank or incorrectly attributed
rows. It rejects unnecessary adjudications that replace an agreed label.
Quoted CSV commas/newlines are supported and spreadsheet formulas are escaped.

Copy evidence.template.json, then record the actual review process. Independent
real data requires genuine human anonymization review, two independent blinded
reviewers and an untouched holdout. Declarations are checked, not independently
verified by software. Synthetic practice stays synthetic regardless of evidence
flags. Do not invent positive labels for projects with no relevant applicant.

~~~text
node reviewWorkflow.js merge --packet C:/PRIVATE/STUDY/coordinator.json --reviewer-a C:/PRIVATE/reviewer-A.csv --reviewer-b C:/PRIVATE/reviewer-B.csv --adjudications C:/PRIVATE/adjudications.csv --evidence C:/PRIVATE/evidence.json --out C:/PRIVATE/NEW-RESULTS
~~~

The importer writes final development/holdout datasets, offline baseline reports
and an annotation audit. No provider requests occur. It records original sheet
hashes, agreement/adjudication counts and exclusions. Cases with no relevant
candidate are preserved as exclusions instead of being forced into positive
ranking metrics. An all-excluded dataset produces no matching percentages.
Reported ranking metrics therefore apply only to retained cases with at least
one relevant candidate. Report the excluded fraction alongside them; they do
not measure whether the system correctly rejects a whole unsuitable shortlist.

Raw reviewer agreement is an annotation-process statistic, not AI accuracy.
The five-case display threshold is not proof of sample adequacy. Review
collection design/sample size with the supervisor. Read limitations, ties,
subgroup counts, Wilson intervals and failure examples in PROTOCOL.md before
making any conclusion. A later Gemini run needs separate external-processing
permission and the existing bounded eval:research --ai command.

Current project phase numbering calls this Phase 4; the older PROTOCOL.md
heading refers to the historical research phase numbering.
