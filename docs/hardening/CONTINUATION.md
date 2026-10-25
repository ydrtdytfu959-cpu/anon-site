# Hardening continuation

Updated 2026-10-24. **In progress; not approved for deployment.**

- Branch: `hardening/anox-system-20261023`.
- First verified milestone: `017a11fde731687c872350d3415501932542ac90`.
- Second verified source milestone: `98191b52d7e0ce41a4f83c21d3572d35818ea1dc`.
- Verified production/main baseline: `5e970fa812095a84273ef188568afeb040317302`.
- Prior design branch and its verified commits are preserved.
- Public production HTML checksum matches the baseline. No production mutation or metered provider request has been made during this hardening work.
- Read-only architecture inventory obtained. Detailed infrastructure/security evidence and the authoritative defect register are retained in the owner's restricted local hardening evidence directory, outside this public repository.
- Implemented: explicit successor-month approval with unchanged UTC usage counters, a private month-status monitor and alarms, and an offline renewal parameter planner. The planner requires owner approval and verified provider allocation; it does not authorize or perform a deployment.
- Implemented and regression-tested: permanent refresh rejection recovery with session-race protection; product detail recovery after invalid-option navigation; consistency between visible and saveable product variants; legacy sandbox reconciliation state preservation.
- Added WebKit to the browser CI matrix. The apparent motion failure was a hidden-element computed-style cache behavior; tests now inspect visible controls and reopen the assistant to verify reduced motion after media changes. No visual design change was needed.
- Candidate validation on 2026-10-23: build and generated-file checks passed; Node **407/407 passed, no skips**. Full Chromium/Firefox/WebKit browser run passed catalog (30 groups), commerce (78 groups), icon rendering (562 checks), preview comparisons, and nine new hardening checks. Browser verification preceded a backend-only legacy webhook addition; all Node tests ran after that addition.
- The independent reviewer reproduced an additional stale-cart navigation recovery case. It is now corrected with a new regression: both rejected-navigation paths pass in all three engines (18 focused checks).
- Added a separate legacy shipping reconciliation candidate with atomic receipt/state persistence and safe replay. Six isolated regressions pass, including failed commits, concurrent delivery and a duplicate receipt committed between reads. It remains disconnected from storefront deployment and does not enable shipping.
- Latest build/check passed; Node **413/413 passed, no skips**. Full Chromium/Firefox/WebKit suite passed after the frontend correction: 30 catalog groups, 78 commerce groups, 562 icon checks, 120 preview comparisons plus 40 close-up/scale checks per engine, and 18 focused hardening checks. The subsequent shipping-only correction has no frontend dependency. Local cfn-lint 1.46.0 validates catalog, commerce and staging templates with no findings.
- Production HTML baseline: 1,094,085 bytes (430,401 gzip). Candidate: 1,094,287 bytes (430,433 gzip), a 202-byte raw / 32-byte compressed increase. No project dependency added.
- Read-only AWS configuration and live unauthenticated access checks are saved privately. No paid usage, payment collection, infrastructure settings, customer records, or production code were changed.
- Independent review covered renewal, authentication, webhook state conditions and UI navigation. A second review verified legacy account/payment boundaries and reproduced shipping defects. Follow-up found a duplicate-receipt interleaving; it is fixed and regression-tested. Reviewers encountered account usage limits; final independent closure is being retried. Do not claim final review sign-off until its receipt is available.
- GitHub publication is in progress using the authenticated connector because normal Git push lacks credentials. The owner explicitly approved the staging-template disclosure after automatic approval review blocked it. Uploaded blob receipts are saved privately and checked against local Git hashes. No hardening PR created yet. Do not merge or deploy this branch without a new owner approval.

Next: finish publication to one sanitized draft hardening PR, compare the remote tree with the tested candidate, and inspect exact-head CI. Complete independent follow-up review when the reviewer is available. See release-gates.md for approval and rollback constraints. Owner approval is required for all production changes. The private publication receipt records the final local/remote SHAs, avoiding self-referential hashes in this document.
