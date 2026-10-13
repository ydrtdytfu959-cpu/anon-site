# Independently reviewable deployment and rollback proposal

**Status: NOT APPROVED; nothing deployed or uploaded.** This is a proposed backend-first rollout for the reviewed source. It does not authorize execution, paid API allocation, a payment, merchant order or PR merge. It supersedes older rollback language that treated all cache-table contents as disposable: the table now includes spending counters, so deleting or restoring them carelessly can recreate allowance.

## Branch and dependency plan

Current development branch is `feat/anox-commerce-foundation`, resumed from `7958718de6d859da1c809abef7b98e012a857973`. The export manifest records the exact remediation commit. [Draft PR #6](https://github.com/ydrtdytfu959-cpu/anon-site/pull/6) is based on `feat/channel3-catalog-phase1`; [draft PR #5](https://github.com/ydrtdytfu959-cpu/anon-site/pull/5) is the prerequisite at `b0ac4df603e300103fd1f2df4aa4d8fe22f4ea07`. Observed main was `9b81ec5c1a791f3aacec4fc3df503bef742c9a84`.

1. Keep both PRs unmerged for independent review. Review the Phase 1 base and commerce/remediation delta separately. Do not duplicate Phase 1 fixes or overwrite a newer branch head.
2. Before any future merge, fetch all three heads and check drift. If PR #5 is approved, merge it first through the agreed GitHub process; then retarget/update PR #6 against the resulting main and resolve only genuine conflicts. Rebuild and rerun the complete final checks after any changed ancestry/content. A reviewed source tree hash is not proof that an unreviewed merge resolution is equivalent.
3. Audit the actual hosting workflow and automatic deployment triggers before approving either merge. No merge is safe merely because deployment is intended later. Frontend promotion must wait for approved backend contracts and release gates, and current production must not be replaced by an older artifact.
4. Deployment approval must name the exact final commit, template hashes, HTML hash, target account/region/API, chosen configuration and change sets. It must separately authorize any artifact upload, quota/configuration change, deployment and frontend promotion. Payment activation remains a separate project gate even after this nonfinancial foundation is deployed.

## Present blockers and expected resource changes

The captured account is `427064007352`, region `us-east-2`, API `zmumi2wruk`. Existing 16 routes, legacy orders/payments/products/shipping tables and Cognito authority must remain functional. See [release-assessment.md](release-assessment.md) for the source/deployed comparison and full issue register.

| Proposed unit | Expected change | Non-negotiable review boundary |
| --- | --- | --- |
| Existing `AnoX-Channel3-Catalog` stack | Update same catalog Lambda code/environment; add cache `UpdateItem` IAM on the same table; enable table PITR/deletion protection; add public detail integration/route/scoped invocation permission; usage/budget/failure alarms. | Preserve function/table physical and logical identity, exact Channel3 secret ARN and existing search integration. No secret values in parameters or artifacts. Reject replacement/deletion or unrelated IAM expansion. |
| Separate commerce stack | One encrypted on-demand retained/PITR/deletion-protected table with `pk`/`sk` and `ttl`; one retained 90-day log group; scoped role; 18-second/256-MB Node 24 Lambda; one integration; seven namespaced routes and scoped permissions; runtime/data alarms. | No import or reuse of legacy orders/payments; no Stripe secret, payment API, exposed webhook or merchant credentials. Stack name at most 55 characters. |
| Existing shared API/stage, separately reviewed | Add `Idempotency-Key` allow-header and `Idempotency-Replayed`/`Retry-After` expose headers; staged throttles only for new commerce routes. | Preserve exactly `https://anox.app`, credentials false, existing GET/POST/PUT/OPTIONS and unrelated stage settings. AutoDeploy is currently true; API edits are production mutations. |
| AWS quota and notifications | Approved regional concurrency increase and existing authorized SNS destination with verified delivery. | Captured concurrency 10/10 cannot support the reserved-concurrency prerequisite. Do not remove reservation as a workaround. No new quota, topic, subscription or test alarm was created here. |
| Frontend | Exact final exported `index.html` with matching generated modules and CSP. | Promote only after backend/CORS/auth checks pass; record current production artifact first, compare immediately before replacement. |

Commerce reserved concurrency defaults to **2**, with an allowed range of **1–5**. AWS requires leaving at least 100 executions unreserved: at least 102 available are needed for the default additional reservation, or 105 for an explicitly approved reservation of 5. Re-read actual account/other reservations immediately before deployment; these numbers are admission conditions, not a throughput promise. [AWS reserved concurrency documentation](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html).

The catalog default policy intentionally allocates zero new upstream search/detail requests. An unchanged default rollout would serve valid cache hits but fail closed on new misses; it is not a behavior-preserving deployment by itself. The operator must approve an explicit current UTC allocation month, reconciled remaining free search allocation, daily/shared/rate caps and detail request allocation. Any paid search allocation additionally needs `PaidUsageEnabled=true` and an approved positive paid limit. Do not equate the 1,000 free monthly credits with daily request limits; other consumers and the provider billing period must be reconciled. See [Channel3 cost assessment](channel3-cost.md). Card-price cache policy remains an external release blocker.

## Private TemplateURL plan

Measured generated templates at this review are **57,354 bytes** (`backend/cloudformation.json`) and **67,130 bytes** (`backend/commerce/cloudformation.json`). Both exceed the 51,200-byte inline TemplateBody limit and remain below the 1 MiB S3 template limit. Re-measure the final committed artifacts; exact hashes/sizes are in the export manifest. No minification or omitted source is used to conceal the limit.

An operator must select and authorize a private existing deployment-artifact bucket in the intended account/region. No bucket has been chosen or verified by this review. The concrete approval package must contain:

- Bucket/account/region, encryption and public-access-block/ownership policy evidence; the exact deployment principal's scoped object read/write permissions and CloudFormation access path. Use SSE-S3 or an explicitly approved KMS key; a KMS choice also requires scoped key permissions.
- Immutable commit-and-content-hash object keys for both templates and separately retained rollback templates. Record object version/checksum after an authorized upload and prevent accidental overwrite. No secret values, customer data or transient credentials belong in an object or its metadata.
- Private HTTPS S3 TemplateURL and version/identity in a saved change-set input. Do not make the bucket public or publish a long-lived signed artifact URL as a workaround. CloudFormation authorization must be validated through the approved deployment identity.
- Reviewed CloudFormation role/capabilities, explicit parameter values, change-set names and a separate execution approval. Named catalog resources may require IAM capability acknowledgement; inspecting a template is not authorization to expand IAM.

**No S3 upload, ValidateTemplate network call, change-set creation/execution or stack operation is performed by this plan.** The local lint/Guard/parity evidence already exists; cloud artifact delivery must wait for approval. CloudFormation limits: [official quotas](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cloudformation-limits.html).

## Reproducible local preparation

Use the exact exported commit in a clean workspace with Node 24 or the recorded build version and locked dependencies. The official build generates both templates and embedded client blocks; do not edit generated blocks manually.

```sh
npm ci
npm run build
npm run check
npm test
ENGINES=chromium,firefox npm run test:browser
cfn-lint backend/cloudformation.json backend/commerce/cloudformation.json
cfn-guard validate -d backend/cloudformation.json -r backend/catalog.guard
cfn-guard validate -d backend/commerce/cloudformation.json -r backend/commerce/commerce.guard
git diff --exit-code
```

Use the browser module/install paths and exact versions recorded in final validation where the local environment requires them. The catalog browser run includes the 135 embedded self-tests. Check CSP hashes, one-image card/media limits, desktop/mobile gallery behavior and standalone/embedded parity. Keep complete stdout/stderr and return codes; do not count mocked AWS/Stripe behavior as live verification.

`scripts/release-preflight.cjs` is an **offline prerequisite checker** over operator-supplied metadata. It has no AWS client or deployment mode. A passing result only says those selected infrastructure inputs satisfy its checks; it never authorizes deployment or payments, proves integration targets, establishes a merchant contract or replaces this runbook. Historical metadata is not a fresh preflight snapshot. The independent reviewer must check the exact target/integration ARNs, full resource diff, business blockers and current runtime artifact identity separately.

After a fresh approved read-only capture, `backend/commerce/stage-api-settings.cjs` can prepare incremental API/stage update and rollback JSON locally. Review its output against the capture and the actual live state again immediately before applying; preserve unrelated route settings. Never apply an old saved rollback wholesale over a newer approved configuration.

## Backend-first execution sequence — only after explicit approval

1. **Freeze reviewed inputs and capture rollback.** Record current main/feature/deployed frontend identities; save current full production HTML, stack templates/parameters, actual Lambda code hashes/versions, API routes/integrations/authorizer/CORS/stage settings, table protection and budget state baseline. Do not fetch secrets or customer rows. Resolve any drift instead of overwriting it. Confirm card caching permission, notification owner and spending policy.
2. **Verify target and capacity.** Re-read account/region/API and JWT issuer/audience/subject requirements. Confirm the exact approved quota and reserved concurrency. Check no route already conflicts and no newer deployment is in progress. Verify private bucket controls and immutable artifact identity. Approve a reviewed change set; reject deletions/replacements of cache or legacy resources and unexpected IAM.
3. **Catalog first.** Apply only the reviewed catalog change, preserving existing search route/function/table identities. Verify cache hit/miss/refresh/cursor behavior using a small explicitly approved request budget; record physical calls and allocated counters separately. Check invalid cursor/ID/options rejection, detail response freshness, private IAM hydration, budget exhaustion/storage failures and bounded errors. Do not use valid financial operations as health checks. The paid allocation may remain zero if an approved reconciled free allocation suffices.
4. **Commerce stack second.** Deploy the separate table/function/namespaced routes using verified existing authorizer and catalog ARN. Validate least-privilege invocation and table access, TTL/PITR/deletion protection, concurrency, alarms and notification delivery. No payment/webhook/merchant route is enabled.
5. **Shared API settings separately.** Apply only the approved incremental CORS/header/throttle diff. Proposed rate/burst limits are capabilities 10/20, quotes and attempts 2/4, order reads 5/10, cancellation/refund 2/4. Existing assistant and other routes remain untouched. Review effects on current traffic; these are request throttles, not billing limits or user fairness guarantees.
6. **Run real-service nonfinancial acceptance.** Use two explicitly authorized Cognito test identities. Reject absent, expired, wrong issuer/audience tokens; reject cross-owner quote/attempt/order IDs without disclosure; reject prices/unknown fields and modified-payload idempotency reuse; exercise concurrent retries/ambiguous completion recovery and expiry without duplicate resources/audits. Check public capabilities truthfully report checkout/cancel/refund disabled, unknown payable/delivered totals, CORS preflight and exposed retry headers, timeout behavior and logs containing no customer/secret payloads. The known metadata probes alone do not satisfy this step.
7. **Confirm legacy behavior read-only.** Compare all 16 route identities/auth/targets; test approved existing health and owned reads without processing a payment. Any change to legacy payment/shipping behavior requires a separate proposal. Do not invoke public checkout/webhook as a harmless smoke test.
8. **Frontend last.** After all prior gates pass, publish the exact reviewed HTML bytes. Verify direct product links/reload, exact merchant/variant selection, unknown/out-of-stock, gallery failure/retry, search/section reset and subsequent cursors, duplicate suppression, cart revisions across tabs/accounts, quote price changes/expiry and explicit unavailable purchasing on desktop/mobile. Monitor errors/budget counters/notifications and compare the deployed HTML hash with the approved manifest.
9. **Record the evidence and stop.** Capture actual statuses, actor, timestamps, artifact hashes and deviations. Passing these steps still does not enable merchant orders or funds. Commercial payment activation needs its own approvals, supported order API, refund/dispute/recovery design and tests.

## Rollback and recovery

Rollback is an approved mutation, not an automatic response to any failed test. Stop frontend promotion whenever a dependency fails. Preserve diagnostics and idempotency/audit records.

- **Frontend dependency failure:** restore the captured actual pre-deployment HTML first, with its own matching CSP. Commit `b0ac4df603e300103fd1f2df4aa4d8fe22f4ea07` is a historical Phase 1 source reference, not proof of the latest deployed HTML. Do not substitute it blindly. Verify bytes and legacy/catalog behavior after restoration.
- **Catalog failure:** prepare a reviewed rollback to a known compatible runtime/template while preserving function/table names and required IAM. A pre-budget runtime bypasses the new spending policy; do not silently roll back to it with unrestricted upstream access. Prefer an approved fail-closed containment or compatible safe artifact until usage has been reconciled. This runbook does not authorize disabling production endpoints.
- **Cache/counter restore:** do not delete the table or budget records as a cache-clear shortcut. If a restore/migration is unavoidable, disable upstream dispatch through an approved procedure, reconcile already consumed provider usage and in-flight attempts, preserve or conservatively seed the consumed baseline, then reapprove the allocation. Restoring an old PITR snapshot cannot grant fresh spending capacity. TTL applies cleanup, not operational authority.
- **Commerce failure:** roll back frontend dependencies before removing/disabling only newly owned routes/function integration. Retain the table, audit and operation records; do not delete or rewrite data to force a retry. Keep encryption/PITR/deletion protection. A future genuine payment would require reconciliation before any processing rollback; this foundation must not have created one.
- **CORS/throttle reversal:** compare captured before/current/desired settings and reverse only this approved delta after confirming no newer client needs it. Preserve origin restriction and unrelated settings. Do not overwrite current configuration with an outdated complete snapshot.
- **Notifications and incident closure:** retain alarms/logs long enough to establish recovery; verify auth rejection, search pagination/cache hits, approved owned reads, CSP and error rates. Record restored commit/template/HTML hashes and unresolved blockers. Never reconcile payment or fee state through browser storage or a local status flag.

No part of this proposal authorizes changing legacy payment resources, deleting production data or exposing credentials. The final decision remains **HOLD for independent review** until the corresponding P0/P1 gates are explicitly resolved with evidence.
