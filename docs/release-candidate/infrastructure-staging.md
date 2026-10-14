# Isolated AWS acceptance and deployment proposal

Status: **prepared in source; not deployed, not approved for execution**. This document closes the infrastructure-design work, not the missing AWS acceptance evidence. The existing production API and legacy payment services are unchanged. Release A still requires staging, operational approval and controlled promotion. Release B remains blocked by merchant/payment/delivery authorization.

## Current evidence and source-versus-deployed boundary

Read-only observations are timestamped in [aws-state.json](aws-state.json), [aws-tables.json](aws-tables.json), [aws-shared-key-roles.json](aws-shared-key-roles.json), [aws-function-boundaries.json](aws-function-boundaries.json) and [aws-catalog-warmer.json](aws-catalog-warmer.json). Metadata initially encountered an automatic approval-service usage-limit failure and was not executed; the same authorized connector succeeded after the user resumed. No alternate tool or account bypassed the failed review. No secret values or customer rows were read.

| Surface | Actual AWS observation | Prepared release source |
| --- | --- | --- |
| Account / region | `427064007352`, `us-east-2` | Same reviewed target for proposed staging; no account mutation |
| API | `zmumi2wruk`; 16 routes, eight integrations; no detail or `/commerce/*` routes | Production catalog adds one detail route; separate production commerce stack adds seven routes. Isolated staging owns its own nine routes (search, detail, seven commerce). |
| Cognito boundary | `qcopg9`, existing issuer `us-east-2_gUci3YuMm`, client `63738r9gpr126qpgp1a5cubchi` | Production reuses reviewed authority. Staging creates a separate admin-created-users-only pool and public client; real staging tokens cannot authenticate to production. |
| Shared CORS / stage | Only `https://anox.app`, credentials false, GET/POST/PUT/OPTIONS; authorization/content-type; no Idempotency-Key. Production `$default` AutoDeploy=true. | Production update remains a separately approved mutation. Staging uses its own `$default` stage, AutoDeploy=false and explicit deployment snapshot; allowed origin remains exactly anox.app with Idempotency-Key and exposed replay/retry headers. |
| Functions | 12 functions; Channel3 artifact last modified October 8; code SHA in inventory, only CACHE_TABLE/CHANNEL3_SECRET_ID environment keys | New catalog runtime, budgets, metrics and detail handler remain undeployed. Staging runtime source is byte-identical to canonical generated production runtime; resource bindings differ explicitly. |
| Lambda quota | GetAccountSettings: 10 total / 10 unreserved; GetServiceQuota `L-B99A9384`: 10, adjustable. No function has a reserved allocation. | Production commerce defaults to 2; staging commerce 2 plus catalog 3. Quota gate remains open. |
| Data | Seven existing tables; all on-demand and ACTIVE. Cache encrypted, TTL expiresAt, PITR disabled/deletion protection false. Six legacy tables PITR enabled/deletion protection false; Payments TTL enabled. | Separate staging cache and commerce table; retained, encrypted, PITR/deletion protection enabled. Production cache protections are staged. No legacy-table replacement/import/write. Null SSE metadata is not evidence of absent default encryption. |
| Monitoring | No metric/composite/log alarms returned | Reviewed alarms and notifications are staged only. Dedicated staging namespaces prevent staging calls inflating production usage metrics. |
| Alternate exposure | All 12 functions have no Function URLs. Shipping GetPolicy returned ResourceNotFound (no function resource policy), not a missing shipping function. | New staged Lambda permissions bind the exact staging API/account. No payment or webhook route. |
| Shared Channel3 consumers | Catalog-API and Channel3-Catalog can read the production Channel3 secret. Chat can invoke Smart-Catalog, which can invoke Catalog-API. AI-Intent reads only OpenAI; anox-api has Orders/log permissions. | New service counters are not provider-account-wide enforcement. Migration requires approved closure or budget integration of the legacy chain. No live IAM/routing was changed. |
| Autonomous invocation | EventBridge `AnoX-Catalog-Warm-V2` is ENABLED every six hours, targeting Catalog-API; description says CJ/Nike warm | This is a separate invocation path outside new counters. Permission/trigger existence does not prove it spends Channel3 credits. Inspect its exact source/input and reconcile actual usage before allocating account allowance. |

The four refreshed legacy processed-template source hashes are in [aws-legacy-source-hashes.json](aws-legacy-source-hashes.json). Each matches the previous local export after accounting for one newline appended by that export. This confirms no substantive processed-template change; it does **not** prove deployed Lambda ZIP parity or successful payment operation. Resource policies expose legacy checkout/webhook only through their captured API bindings; some legacy permissions are broader than new route-specific permissions and remain outside this change's authority.

## Concurrency decision — REL-03

AWS requires at least 100 concurrent executions remain unreserved after a reservation. [AWS reserved concurrency](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html) and [API restriction reference](https://docs.aws.amazon.com/powershell/v5/reference/items/Write-LMFunctionConcurrency.html). A regional quota increase does not itself launch invocations or buy provisioned capacity; reserved concurrency has no separate charge, while actual requests/duration/storage/monitoring remain billable. This proposal does not enable provisioned concurrency.

- Production commerce default 2 needs **102 currently unreserved** immediately before adding it. A reviewed value of 5 needs 105. Recheck existing reservations and other deployment activity first.
- Isolated staging defaults reserve 2 commerce + 3 catalog, requiring **105 currently unreserved** before the new stack. If production's reservation of 2 is also present, regional total must be at least107, assuming no others.
- Proposed quota request target: **200 regional concurrent executions**. This is an approval proposal, not a request submitted to AWS. It leaves193 unreserved after the two defaults above, providing room for the12 existing functions and the mandatory100 reserve. If AWS grants only107, the stated simultaneous allocations fit exactly but provide less operational headroom. AWS may apply a different approved quota; verify the actual result rather than assuming it.
- Workload model: two commerce executions at two-second end-to-end duration have a theoretical ceiling near one request/second; at nine seconds, roughly0.22/s. These are queueing arithmetic, not measured service capacity. Each quote has at most five distinct product-option snapshots and three concurrent detail reads. Two quotes can attempt six catalog calls concurrently; staging's catalog reservation3 intentionally bounds that pressure and may throttle competing waves. The quote stage throttle0.2/s, burst2 supports controlled serial acceptance, with a separately controlled contention case. No retry loop may amplify throttles.
- Actual p95/p99/cold-start latency, duration, rate-window interaction, failed reservations and other function demand must be measured in staging before raising limits. Existing unreserved functions gain capacity from the proposed quota increase; they are not given a higher application spending allocation. Account-wide concurrency is not an API billing limit.
- Safe delay fallback: keep source and offline fixture tests reviewable, leave the new stack undeployed, retain existing production behavior and disabled checkout. Alternatively propose a separately approved isolated AWS account with adequate quota and explicit staging credentials; this generator is scoped to the stated account, so such a change requires a reviewed target update. Do not remove reserved concurrency, weaken budgets, repoint staging to production, or create a hidden unbounded path to bypass the quota.

Estimated staging Lambda compute, excluding any free tier: 100 worst-case18-second commerce invocations at256MiB =450GB-seconds; 28 twenty-second catalog invocations at256MiB =140GB-seconds. This is an upper workload assumption of590GB-seconds, not a tariff quote or promise that all100HTTP requests invoke commerce. Apply the current us-east-2 Lambda price from the cost report and include DynamoDB transactional request units, PITR/storage, log ingestion/retention, CloudWatch alarms/custom metrics, API Gateway and Cognito. The proposed100AWS-test-request ceiling is for operator-dispatched test operations, not a bound on internal SDK calls or total AWS billing. No paid test was performed.

## Exact isolated staging artifact

`backend/staging/build-template.cjs` composes the canonical catalog and commerce generators; `backend/staging/cloudformation.json` is generated by the official `npm run build` and checked by `npm run check`. There is no copied alternative application implementation. It provisions:

- Independent HTTP API, explicit content-derived Deployment snapshot and `$default` stage with AutoDeploy=false. Using a separate default stage preserves the canonical path contract without a named-stage prefix assumption. It does not touch production's `$default`.
- Independent retained Cognito pool, admin-only user creation, password policy, no app-client secret, token revocation,15-minute ID/access tokens. USER_PASSWORD_AUTH matches `auth.js`; SRP and refresh flows are also allowed. Only two approved synthetic test identities should be provisioned. No test user was created.
- Separate catalog and commerce Lambdas, scoped roles, log groups, encrypted retained/PITR/deletion-protected DynamoDB tables, exact local invocation target, and isolated metric/alarm namespaces. No production API/client/pool/secret/function identity may appear in the generated artifact. New functions have no Function URL or Stripe permissions.
- No secret or SNS creation: mandatory existing approved `AnoX/Channel3/Staging-<suffix>` secret ARN and `AnoX-Staging-*` notification topic. The secret must hold an authorized distinct credential; a different secret name containing the production key is not isolation. If the provider bills both keys under one account, reconcile/subtract the staging allocation from that account's remaining allowance.
- Default new spending0. Hard template maxima:3 verified free search requests/month/day;25 detail requests/month/day;28 total/day;2requests/second. Paid usage is disallowed in this staging template. Allocation month is explicit and cannot renew itself. Catalog/search cache hits need no new reservation. Misses are intentionally unavailable until approved allocation; this is disclosed rather than disguised as a working production catalog.
- Seven commerce routes with six JWT-protected operations, two public catalog routes. Private paths: quotes, attempts, order list, order read, owner-checked unsupported cancellation and refund. Capabilities stays public and reports purchasing disabled. No new payment/webhook endpoint exists.

Only one approved staging stack should be active under the shared `AnoX/Staging/*` metrics namespaces. Multiple test environments require separately reviewed metric dimensions and provider-wide allocations, not duplicated budgets.

## Route and failure contracts

The authoritative contracts remain [commerce README](../../backend/commerce/README.md) and [catalog README](../../backend/README.md). A quote is201 with exact integer line amounts, estimated product subtotal, one conditional500-cent fee and unknown delivered/payable total; checkout attempts are201 `blocked`, not orders/payments. Missing/invalid auth is401; foreign-owned and missing quote/order access is404; modified idempotent payload or in-flight operation is409; unknown fields/client prices are400; unsupported currency/destination/line bounds are422; content type415; oversized body413; unavailable fresh provider/DynamoDB is503. Token expiry at equality rejects authority. Quotes remain bounded by30-second snapshot/creation freshness and do not reserve inventory.

API integration timeout20s exceeds commerce Lambda18s. Quote hydration has nine-second deadline, at most three concurrent detail calls and one transport attempt per call; downstream Lambda invocation can continue after caller cancellation, so budget accounting must retain uncertain reservations. DynamoDB operations have1.5-second deadlines and durable same-key replay/conditional fencing; do not retry ambiguous mutations with a new key. API throttling can return429 before Lambda; API and provider response errors must be classified separately. Public search/detail uses bounded validated IDs/options/cursors and sanitized errors. `Idempotency-Key` is required for mutations; CORS preflight includes it and exposes replay/retry headers.

## Approval packet and exact command sequence

All commands below are **proposed operator commands**, not executed by this review. Approval must identify commit/tree, template/HTML hashes, staging stack name (`AnoX-Staging-*`, at most55characters), target account/region, deployment role, private bucket/object identity, secret ARN, notification destination, quota, test identities, request allocations and retention owner. Never substitute production credentials. The operator must supply reviewed JSON parameters, not paste secret values.

Local verification (safe now):

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
cfn-lint backend/cloudformation.json backend/commerce/cloudformation.json backend/staging/cloudformation.json
cfn-guard validate -d backend/staging/cloudformation.json -r backend/staging/staging.guard
sha256sum backend/staging/cloudformation.json
wc -c backend/staging/cloudformation.json
```

The final manifest supplies exact size/hash; the combined staging template exceeds51,200bytes and requires a private S3 TemplateURL, below1MiB. The artifact bucket must have all public-access blocks, encryption, versioning, restrictive deployment permissions and an approved retention policy. Use a content-hash/commit key, verify object checksum/version and retain the prior approved template separately. No bucket/upload/change set was created here.

After **separate explicit approval** of quota, artifact upload and change-set creation:

```sh
# Variables must be supplied from the signed approval packet; never infer values.
aws sts get-caller-identity
aws lambda get-account-settings --region us-east-2
aws service-quotas get-service-quota --service-code lambda --quota-code L-B99A9384 --region us-east-2
# Quota request, only if specifically approved, target200:
aws service-quotas request-service-quota-increase --service-code lambda --quota-code L-B99A9384 --desired-value 200 --region us-east-2
# Wait for actual approved capacity, then independently review permissions/identity.
aws s3api put-object --bucket "$ANOX_REVIEW_BUCKET" --key "$ANOX_REVIEW_OBJECT_KEY" --body backend/staging/cloudformation.json --server-side-encryption AES256 --checksum-algorithm SHA256 --region us-east-2
aws s3api head-object --bucket "$ANOX_REVIEW_BUCKET" --key "$ANOX_REVIEW_OBJECT_KEY" --region us-east-2
aws cloudformation create-change-set --stack-name "$ANOX_REVIEW_STACK" --change-set-name "$ANOX_REVIEW_CHANGE_SET" --change-set-type CREATE --template-url "$ANOX_REVIEW_TEMPLATE_URL" --parameters file://approved-staging-parameters.json --capabilities CAPABILITY_IAM --role-arn "$ANOX_REVIEW_DEPLOY_ROLE_ARN" --region us-east-2
aws cloudformation describe-change-set --stack-name "$ANOX_REVIEW_STACK" --change-set-name "$ANOX_REVIEW_CHANGE_SET" --region us-east-2
```

Creating a change set itself requires approval here. Review stack naming, parameter values, route/auth/CORS bindings, quotas, scoped IAM, table/pool retention and absence of production references. If updating an existing staging stack, use a separately reviewed UPDATE change set; reject replacements or deletions of retained state. Inspect CloudFormation pre-deployment validation events when supported by the approved CLI. Do not convert a failed validation into success by disabling protections.

Only after approval of that exact change set:

```sh
aws cloudformation execute-change-set --stack-name "$ANOX_REVIEW_STACK" --change-set-name "$ANOX_REVIEW_CHANGE_SET" --region us-east-2
aws cloudformation describe-stacks --stack-name "$ANOX_REVIEW_STACK" --region us-east-2
aws cloudformation list-stack-resources --stack-name "$ANOX_REVIEW_STACK" --region us-east-2
```

Capture outputs, deployed code/template hashes and policies, fresh quota and notification evidence. Provision two test customers through an approved operator flow; no passwords/tokens in CLI arguments, source, screenshots or evidence. A temporary password challenge must be completed through the approved Cognito flow because the existing frontend intentionally rejects unsupported authentication challenges.

## Real-service acceptance matrix — all pending

`scripts/prepare-staging-acceptance.cjs` is a **nonexecuting plan validator**, not an AWS test runner. It rejects the production API ID, wrong account/region/stage, unknown credential fields, altered customer aliases and oversized budgets. It admits only `customer-a` / `customer-b` aliases, hashes and an operator approval reference. Its `readyToExecute` means the supplied plan is structurally complete; a JSON boolean cannot grant approval or verify infrastructure. No request is issued by the script. A separately approved operator/runner must enforce counters before dispatch and record actual evidence. Fixture-passing plans are not AWS acceptance results.

Prepare `approved-plan.json` using exact stack outputs and final commit/template hash, not invented IDs. Schema: `{schemaVersion:1,account:'427064007352',region:'us-east-2',apiId:<isolated output>,stage:'$default',stackName:<approved>,sourceCommit:<40hex>,templateSha256:<64hex>,customerAliases:['customer-a','customer-b'],approval:{reference:<approval id>,granted:true},budgets:{searchRequests:3,detailRequests:25,awsRequests:100,writes:40}}`. The writes cap means operator-initiated mutating test actions, not underlying DynamoDB writes/capacity. The full matrix may need several separately approved sessions; never silently raise caps or reset monthly counter records to finish it.

```sh
node scripts/prepare-staging-acceptance.cjs approved-plan.json > reviewed-acceptance-plan.json
```

| Test / evidence | Classification | Required real result and prerequisites |
| --- | --- | --- |
| Source contracts, adversarial handler/money/leases, generator/CSP/Guard | Local unit | Existing final suite; injected transports. Does not prove AWS signatures/transactions. |
| PDP/cart/gallery/selection/quote UI in Chromium/Firefox desktop/mobile | Browser fixture | Final browser suite; simulated API/provider responses explicitly identified. |
| API route bindings, Lambda payload2.0, status/schema and CORS allow/expose headers | AWS integration | Compare nine staging routes and captured targets/authorizer; allow only anox.app and Idempotency-Key; test blocked origin and no wildcard. |
| Real JWT auth | AWS integration | Two real staging ID tokens; missing, modified signature, expired, wrong audience and production-pool token rejected401. Record token class only, never JWT/password. |
| Ownership | AWS integration | A quote inaccessible to B; owned/missing foreign order IDs404; B cannot cancel/refund A. A-owned cancellation/refund409 unsupported/no writes. Seed two synthetic order fixtures only through separately approved staging-table action, never merchant purchase. |
| Atomic claims/replays | AWS integration | Submit same quote key/body concurrently within approved burst;409 in-flight or identical201 replay, one quote/audit and no duplicate hydration. Same key/changed body409 before provider; same key A/B remains partition-isolated. Count real consistent records in staging only. |
| Ambiguous reply/recovery | AWS integration | Client drops response after request dispatch, then same key/body; identical resource returned. Partial transaction failure creates no fabricated state; never delete receipts to retry. Network fault simulation remains labeled simulated fault injection against real AWS. |
| TTL/leases | AWS integration | Freshness expires at30s even while TTL row persists; lease owner cannot delete successor claim. Test bounded fixture rows under approved prefix; TTL cleanup timing is not acceptance authority. |
| Private catalog invocation and IAM | AWS integration | Commerce role can invoke only staging catalog and its table/logs; explicit negative attempts to production tables/secrets/functions must return AccessDenied without fetching any actual secret. Use approved IAM policy simulation first; actual negative runtime probes need separate test-role authorization. |
| Search/detail/quotes | Real provider read | At most3 authorized search misses; page1/2/3 only if cursor exists, cache replay no upstream, no duplicates, invalid/expired token does not restart. At most25 detail attempts shared with fresh quote hydration; price/stock/merchant/options and30s expiry verified. Do not fabricate third page or available stock. |
| Concurrent cache misses and spend | AWS integration + Real provider read | Identical misses coalesce across executions; conditional four-counter reservation observed; all denied/exhausted/malformed policy cases dispatch zero provider calls. Reconcile physical attempts separately from invoice credits; cached result does not consume a new allocation. Stop once cap reached. |
| Cold start/timeouts/throttling | AWS integration | New version/idle cold start and warm handler durations measured; two quotes/six potential reads vs catalog3 reservation; safe429/503, no new-key retries or partial quote. Raising load or redeploying for cold-start requires its own approval. |
| Notifications | AWS integration | Actual staged error/budget alarm reaches approved operator destination with timestamps; permission to induce one safe failure/test notification required. Static alarm resources are insufficient proof. |
| Counter recovery | AWS integration | Approved staging restore rehearsal starts with upstream disabled; no old counters grant allowance; reconcile baseline and reapprove before provider dispatch. This is a separate cost/resource mutation budget, not included in100 requests. |
| Browser against staging | AWS integration | Use an isolated local staging build with API URL and Cognito pool/client bound to exact outputs, regenerate CSP to allow only that staging endpoint. Keep origin anox.app using an isolated browser host mapping/review server; never upload this artifact to production or disable browser security. Record separate staging hash. No frontend target may silently remain production; this target-specific artifact and browser session require deployment outputs before preparation. |
| Merchant/Stripe/carrier | Provider sandbox | Not performed; separate approved contracts/credentials and nonfinancial acceptance prerequisites. No simulated purchase is release evidence. |
| Existing production safety | Production smoke | Approved metadata/auth rejection/health only. Never invoke checkout/webhook or write production customer data as a smoke test. |
| Rollback rehearsal | AWS integration | Approved staging artifact/version rollback preserves tables, receipts, logs and budgets; confirm owned reads/auth/catalog after. No production rollback mutation is authorized. |

Persist sanitized test IDs, request counts, timestamps, status/error codes, deployment/commit/template identities and pass/fail evidence. Tokens, addresses, customer bodies, API keys and full provider payloads must not enter logs/reports. A failure pauses the dependent test group; record it and preserve state.

## Recovery and production promotion

A table restore is a new table with old data, not an authorization reset. Disable upstream dispatch via an approved zero-allocation/empty-month configuration before restoring or changing table bindings; verify zero physical requests. Reconcile provider consumption, other credentials/consumers, in-flight/ambiguous attempts and retained counter/audit snapshots. The safest reviewed recovery allocation is a new explicitly approved **remaining** allowance with consumed reservations conservatively represented; do not add the full original allowance to a restored stale baseline. Preserve exact monthly/day/class keys and ≥90-day retention for spending counters. Only reopen after an independent operator verifies limits/counters and reapproves the remaining allowance. Restored tables do not automatically inherit every operational setting; verify TTL/PITR/deletion protection, encryption, IAM and alarm bindings.

For staging rollback, retain all tables/pool/logs. Prepare a change set pointing to the last approved compatible template and its explicit API deployment snapshot; retain current diagnostic/audit records. Never downgrade to a pre-budget runtime that can dispatch uncontrolled requests. No cleanup of retained resources is automatic or authorized. Stop test traffic and keep allocations closed if no safe previous runtime exists.

Production promotion follows the candidate [deployment and rollback runbook](deployment-and-rollback.md), which supersedes the historical ordering for the new presentation-only search response. Do not deploy schema-2 search beneath the old frontend: use an approved maintenance window or a separately reviewed transitional additive-route artifact. Approve quota/notifications/account budget and shared-key isolation, capture current deployed identities, preserve all legacy resources, verify backend/CORS/auth, then promote the compatible exact HTML/CSP. Existing production AutoDeploy=true makes route/header changes live mutations. Reject unreviewed drift or destructive replacement; do not upload templates or create/execute change sets merely to prove readiness.

Independent review found and corrected two staging contract mistakes (missing USER_PASSWORD_AUTH; schema rejection expected422 rather than400) and ambiguous alias mapping. Regression tests were observed failing then passing; the final test now compares the planned400 with the real commerce handler and verifies zero provider reads. The API-settings preparation helper also rejected only origin drift before this release; a demonstrated regression now rejects broadened credentials/methods/headers and malformed stage metadata before producing an update. Full final validation belongs to the release-candidate validation artifact.
