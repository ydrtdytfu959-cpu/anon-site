# AnoX production launch — October 18, 2026

## Authorization and preserved release

The owner explicitly authorized merging PR #26 and deploying the completed release, including necessary backend/infrastructure updates and bounded live verification. This supersedes the historical no-deploy boundary in ENGINEERING_CHECKPOINT.md. Payments, merchant/carrier purchases, fee qualification changes, destructive data operations and increased spending remain unauthorized.

- Local preserved branch: fix/anox-engineering-overhaul-20261016, commit 04521a98fde8b9591c4de9df643f7faff4b1b4dc.
- Published PR: https://github.com/ydrtdytfu959-cpu/anon-site/pull/26
- Last verified PR head: a92e335094b44e6240a4080701ed6aa9d4d917fa; exact tree matches local release: c90014b96cde5c7f1a0f81d8e721216c980c28f0.
- Expected released index.html SHA256: e9813fe542f354604221a767f63aca90fe985b39d830735f6c95cf5b6e94cb96.
- Previous frontend: c6c58956ebc28f61f32509f0848f115907d31a7a, SHA256 f5fb50f1bc0199671f491498010a96e26d3e81138dee72b5980582799604d6cf.

## Current execution

Recovered clean working tree and preserved all commits. Fresh npm run check passes. Live canonical site still serves previous frontend. Prior launch agent turns stopped at the usage limit before reporting any production mutations; fresh AWS/PR inventories are running to verify this before any deployment.

Backend must precede merge: GitHub Pages automatically publishes main independently of the catalog CI job. Save current templates/code/configuration, validate candidate templates, review change sets for replacement/deletion, deploy only changed resources, then merge the exact tested PR head. Preserve 500 monthly searches, 60 daily searches, 200 monthly details, paid credits 0 and paid usage false; preserve existing counters and all table/customer data. Fresh budget/counter verification is required before metered smoke.

## Next action

Finish read-only deployment inventories and template validation. Parent coordinates all production writes. Record each completed AWS change and merge SHA here immediately; do not infer completion from intended commands. Pending: backend updates, merge, Pages publication, bounded real retailer/auth/service-request/mobile verification, post-release diagnostics.

## Completed/in-flight AWS actions (13:07–13:12 UTC)

- Catalog and commerce candidate templates passed cfn-lint 1.46.0 and repository cfn-guard rules. Both non-executed AWS change sets reached CREATE_COMPLETE with no validation error events; only code, dependent integration references, and new service-request route/permission were listed, without replacement/removal. All parameters use previous values.
- Private versioned S3 prefix: s3://anox-deploy-artifacts-427064007352-us-east-2/releases/2026-10-18-a92e335/. Candidate and before templates plus legacy candidate/rollback ZIPs saved. Local before-state evidence: ../anox-launch-2026-10-18/.
- Catalog change set 28411039-654f-49ba-a226-f8f7749ac60a executed. Verified UPDATE_COMPLETE; Lambda Active/Successful, code hash uQw7dwXbZNRq9bju2ne0TTp8VxdjXW9aS1jpGcfoGHQ=. Limits unchanged.
- Commerce change set 8034e6ef-26d1-481f-9256-259e482511ff executed; stabilization verification next.
- Legacy UpdateFunctionCode submitted using private S3 object version EbWfNhbC7z3PFKV931ecLjeX.DL6sLHI and expected old RevisionId. Response code hash kVJ2Ziw7hOZ5+JhhmA0O5YO21qZUzI8qZVqDBecu44Y= (exact candidate), InProgress; verify stabilization before any invocation.
- No provider requests made yet in this launch. Fresh prelaunch counters monthly98 search/44 detail; Oct18 day keys absent. Paid false/0, monthly500 search/200 detail, daily60 search/100 detail, shared150 and5/sec.
- PR remains unmerged until backend and authenticated acceptance pass. Do not execute these change sets again.

## Live acceptance blocker and correction — October 19 continuation

- Commerce reached UPDATE_COMPLETE and Active/Successful with code hash Q4zLsBnX2S7H8tKTvxmWPnNFzBba9rekbaR6l5/oTb8=. Legacy Active/Successful exact candidate hash verified; invoking {action:warm} returned ok:true,source:CJ,advertiser:NIKE,warmed:20. No Channel3 fallback was introduced.
- Added bounded commerce stage throttles, preserving existing assistant throttles, CORS and AutoDeploy. Public health/capabilities200, unauthenticated orders/service requests401, invalid retailer filter400. Paid checkout/fee collection remain disabled; serviceRequests.create is true.
- Two dedicated SUPPRESS QA accounts created (no messages). Initial eight JWT/CORS/account-read checks passed. First genuine Nike detail200; one quote refresh failed503. DynamoDB contained only its temporary working claim, no quote/order. An impossible-condition diagnostic write was rejected before mutation with ValidationException: reserved keyword ttl. TOKEN is also reserved.
- Corrected commerce store expressions to alias token/ttl during complete/release/stale takeover. Added three regressions that failed before correction; fixed ValidationException diagnostic category retains redaction. Full npm build/check pass, Node380/380 pass with0skips; Chromium/Firefox regression rerun in progress. No frontend source changed.
- Next: deploy regenerated commerce-only correction, refresh the dedicated QA sessions (old temporary tokens may be expired), rerun bounded two-account acceptance using genuine qa-selection.json, publish correction onto PR26 and await CI, then merge and validate Pages plus bounded browser coverage. Preserve failed QA evidence and do not delete customer or audit data.
