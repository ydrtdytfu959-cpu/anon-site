# Candidate deployment, approval and rollback runbook

**Preparation only. Nothing in this file authorizes execution.** This candidate is for independent review, not controlled deployment. Preserve the baseline [detailed runbook](../remediation/deployment-and-rollback.md) for its capture/rollback procedures; this document supersedes its cached-price policy and adds isolated staging and exact compatibility ordering.

## Source and merge dependencies

Work remains on `feat/anox-commerce-foundation`, based on published remediation `dd11ddedf277d74446d77af6836a67ee30abebf7`. The final manifest supplies the new commit/tree. [Draft PR #6](https://github.com/ydrtdytfu959-cpu/anon-site/pull/6) depends on [draft PR #5](https://github.com/ydrtdytfu959-cpu/anon-site/pull/5), Phase 1 at `b0ac4df603e300103fd1f2df4aa4d8fe22f4ea07`. Last reviewed main was `9b81ec5c1a791f3aacec4fc3df503bef742c9a84`.

Do not merge either automatically. Verify both remote heads and the hosting/deploy workflow before any future merge. If approved, merge Phase 1 first, retarget/review the commerce delta against the resulting main, and rerun all checks after any conflict resolution or content change. A branch merge must not publish an old frontend into a newer production deployment. The present CI workflow tests code and has no deployment step; independently verify external hosting triggers before approving a merge.

## Required approval package

The operator must explicitly approve the target account `427064007352`, region `us-east-2`, exact commit/tree/template/HTML hashes, environment, artifact bucket/key/version, CloudFormation role and capabilities, chosen parameters, non-destructive change sets, quota, SNS destination and bounded test spending. Staging and production are separate approvals. Payment/merchant activation is not included in either.

Before any upload/change set, capture actual production HTML bytes/hash, Lambda CodeSha256/versions/configuration keys, processed templates/parameters, API routes/integrations/JWT/CORS/stages, role/resource policies, tables/protections and current reservation/counter baseline. Fetch no secret value. Store sensitive operational rollback metadata in an approved private location, not a public repository. Recompare immediately before applying; reject unexpected drift or replacement/deletion of existing resources.

All generated templates exceed the 51,200-byte inline TemplateBody limit; exact final sizes are recorded in validation. Use a private encrypted S3 artifact bucket and immutable commit/content-hash object keys. Review public-access block, object ownership, least-privilege upload/read and any KMS permissions. Confirm object version/checksum after an **approved** upload. Do not use a public bucket or long-lived signed URL as an access workaround. No bucket, upload or change set has been created by this mission.

The safe local preparation is:

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
ENGINES=chromium,firefox npm run test:browser
cfn-lint backend/cloudformation.json backend/commerce/cloudformation.json backend/staging/cloudformation.json
cfn-guard validate -d backend/cloudformation.json -r backend/catalog.guard
cfn-guard validate -d backend/commerce/cloudformation.json -r backend/commerce/commerce.guard
cfn-guard validate -d backend/staging/cloudformation.json -r backend/staging/staging.guard
git diff --check
```

The [isolated staging runbook](infrastructure-staging.md) provides the exact staging template, parameter boundaries, snapshot stage and acceptance matrix. `scripts/prepare-staging-acceptance.cjs` validates a nonexecuting protocol; an input approval boolean cannot grant real authorization. The offline release preflight is similarly limited. Neither tool may be treated as an executor or cloud acceptance test.

## Deployment prerequisites and ordering

1. **Review and isolate test infrastructure.** Obtain concurrency approval first: fresh account quota is 10/10; staging reserves 3 catalog + 2 commerce and needs at least 105 available under the 100-unreserved rule. Production's default new commerce reservation alone needs at least 102 available; an ongoing staging reservation adds to the total. Recalculate from all actual reservations. Do not remove caps to bypass the prerequisite. Use separately authorized staging credentials, Cognito users, counter/table namespace and notification destination.
2. **Prove staging before production.** Run real Gateway JWT/ownership, DynamoDB conditional/CAS/idempotency, scoped Lambda invoke, CORS, freshness, budget, metrics/alarms, latency/throttle and rollback tests after specific approval. Paid/provider reads need an explicit test allowance even in staging. Record fixtures, AWS integration, provider reads and sandbox operations separately. A 404 on missing production endpoints is evidence of absence, not a failed implementation test to repair by deploying without permission.
3. **Resolve operational release gates.** Approve reconciled monthly free/paid/detail/shared limits, account-wide consumer scope, legacy-secret isolation/drain and notification ownership. Unknown provider usage means zero new capacity. Approve separate legacy checkout containment; no browser path in the new frontend falls back to it, but it remains deployed independently. Final shipped policy must not be an unusable zero-allocation catalog described as normal operation.
4. **Choose a reviewed compatible rollout.** The new presentation-only search response breaks the older price-required frontend. The candidate frontend accepts older full-card responses safely by discarding volatile fields, but requires additive detail/commerce routes. The simplest complete-artifact route is an approved maintenance window: preserve the actual previous frontend/stack artifacts, display a separately reviewed temporary availability message, deploy backend dependencies and API settings, verify them, then promote the exact candidate HTML and reopen. No maintenance artifact or production change is authorized here.
5. **Alternative incremental rollout requires additional review.** Deploy only additive detail/private hydration/commerce dependencies while keeping a compatible search response, then publish the candidate frontend, then switch search to schema-2 presentation-only data. This requires a separately built and reviewed transitional backend artifact; it is not contained in the final full-runtime artifact and must not be improvised by editing generated Lambda code. If no such artifact is approved, use the maintenance plan. Never deploy schema 2 first under the old frontend.
6. **Production backend units.** Update the same catalog Lambda/cache physical resources; preserve existing search integration and secret ARN. Enable staged table protection/counter IAM/alarms and add detail route. Create the separate commerce stack/table/function and seven routes using the verified Cognito authority. Reject legacy resource replacement, payment permissions or unexpected IAM expansion. No financial webhook route exists.
7. **Shared API edits are live changes.** Existing `$default` has AutoDeploy enabled. Separately approve incremental `Idempotency-Key` preflight, replay/retry exposure and throttles using `backend/commerce/stage-api-settings.cjs` output against fresh captures. Preserve exact `https://anox.app`, credentials false, existing methods and unrelated settings/routes. Verify all 16 previous routes' method/auth/integration identities remain intact.
8. **Verify and promote exact bytes.** Run approved nonfinancial smoke/acceptance, verify alarms and rollback artifacts, then promote the manifest's full HTML with matching inline hashes. Check direct product URLs, merchant/variant selection, gallery recovery, cursor pages/search resets/sections, one-image cards, cart tabs/account changes, quote price changes/expiry and honest blocked checkout on desktop/mobile. Record actual deployed HTML hash and runtime versions. Do not infer success from a previous local result.

## Rollback invariants

- Stop promotion when any dependency or acceptance fails. Restore the captured actual frontend only with a compatible backend/card policy; an older commit is not proof of the current production artifact. A paired fail-closed or maintenance state is preferable to silently displaying stale cached offers or enabling unbudgeted calls.
- Preserve catalog cache/counter/table identities. Do not delete budget records as cache clearing. An old PITR snapshot can recreate spending allowance: halt all upstream consumers, reconcile consumed and in-flight provider usage, conservatively seed/preserve the baseline, and obtain renewed approval before dispatch. Never roll back to a pre-budget unrestricted runtime to recover availability.
- Retain new commerce records/audits and legacy data. Roll back only newly owned routes/integrations after frontend dependencies are removed; keep encryption, retention, PITR and deletion protection. No payment/order mutation is an incident workaround.
- Reverse only the approved CORS/throttle delta after comparing current state with captured before/after; do not overwrite newer approved changes using a stale whole snapshot.
- Keep signature-verified legacy webhook drain and owned historical reads during any separately approved payment containment. Re-enabling legacy creation or restoring unbudgeted secret grants requires a new explicit approval, not a blind rollback.
- Record actor, timestamps, old/new artifact hashes, counters, observed effects and remaining blockers. Verify rejection/ownership/CSP/catalog behavior and notification delivery after recovery. Keep checkout disabled throughout.

Final Release A promotion requires independently reviewed source plus actual staging and operational approval evidence. Release B additionally requires the entire [merchant/payment activation contract](checkout-activation-spec.md) and [Algeria delivery matrix](algeria-delivery.md). No command in this review package grants either approval.
