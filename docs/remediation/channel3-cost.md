# Channel3 usage, cost policy and caching release gate

Reviewed October 12, 2026. Source implementation is staged in `feat/anox-commerce-foundation`; no AWS setting, provider account setting or production budget was changed by this review. This document supersedes the earlier engineering report's 1,000 paid searches/day default. That former default was not a free allowance and was unsafe without an explicit spending decision.

## Provider evidence and limits of knowledge

Channel3's [public pricing](https://docs.trychannel3.com/pricing), retrieved during this review, lists 1,000 free **credits per month**, then **$0.007 per additional credit**. `/search` consumes one credit per request, including continuation requests. `/lookup` also consumes one credit and is not the product-detail endpoint. `GET /v1/products/{id}` is listed as free. AnoX implements search and product retrieval; it does not implement paid lookup. These are published list terms, not an independently verified tariff, invoice, account balance, plan or remaining allowance for ANOX LLC.

The [rate-limit documentation](https://docs.trychannel3.com/faq/rate-limits) lists a default plan with a shared 10,000-request daily quota and 10 requests/second for most/search endpoints, while lookup is 5/second. A request limit is not a credit allowance or spending limit. The current account plan, billing renewal timezone, other API consumers, charged failures and actual invoice rules have not been reconciled. The new controls are conservative application allocations, not provider billing reconciliation.

The earlier 1,000 searches/day limit could permit 31,000 search credits in a 31-day month. At the published rate, 30,000 credits beyond an otherwise unused 1,000-credit allowance would be $210, before any other billed usage or account-specific terms. This illustrates why daily quotas do not establish free operation; it is not a forecast of actual charges.

## Implemented source policy

Every upstream request requires an explicitly configured current UTC allocation month. Blank configuration or month rollover blocks uncached upstream work. There is no automatic free-credit renewal assumption. Existing fresh cache hits remain readable without a new reservation.

| CloudFormation parameter / environment variable | Default | Meaning |
| --- | --- | --- |
| `BudgetMonth` / `BUDGET_MONTH` | empty | Approved UTC allocation month, `YYYY-MM`; empty/elapsed month fails closed. |
| `FreeSearchMonthlyCredits` / `FREE_SEARCH_MONTHLY_CREDITS` | 0 | Verified remaining free credits allocated to this service, at most 1,000; never an inferred provider balance. |
| `PaidUsageEnabled` / `PAID_USAGE_ENABLED` | false | Explicit opt-in; grants no credits by itself. |
| `PaidSearchMonthlyCredits` / `PAID_SEARCH_MONTHLY_CREDITS` | 0 | Explicit additional monthly paid-credit allocation; positive value requires opt-in. |
| `SearchDailyLimit` / `SEARCH_DAILY_LIMIT` | 0 | Search attempt cap per UTC day inside the monthly allocation. |
| `DetailMonthlyLimit` / `DETAIL_MONTHLY_LIMIT` | 0 | Product-detail request allocation, separate from search credits. |
| `DetailDailyLimit` / `DETAIL_DAILY_LIMIT` | 0 | Product-detail attempts per UTC day. |
| `TotalDailyLimit` / `TOTAL_DAILY_LIMIT` | 1,000 | Shared search + detail request cap per UTC day; cannot authorize either class alone. |
| `UpstreamPerSecondLimit` / `UPSTREAM_PER_SECOND_LIMIT` | 5 | Shared fixed UTC-second cap, bounded to 10. |

An operator must reconcile provider usage and other consumers before approving an allocation, especially on first deployment or mid-month migration. Within a month, configuration represents the total permitted reservations in this service's retained counters, not an additional top-up. Increasing a limit adds only the difference; reducing it below consumed reservations stops new requests. Keys contain period and class, not limit/configuration hashes, so changing settings cannot reset usage. Renew the month explicitly only after verifying the provider's allowance/billing period and approving the new allocation. Never delete counters to renew capacity. The UTC window is an internal control; it must not be assumed identical to the provider's unverified billing timezone.

A single idempotent DynamoDB transaction increments four conditional counters: month/class, day/class, shared day, shared second. Non-numeric/negative counters are rejected. The existing dedicated table remains encrypted/retained and now stages deletion protection and point-in-time recovery because it also holds spending-control state. Monthly counters persist until at least 90 days after their month ends; TTL is cleanup, never the authority for expiration. SDK retries reuse the same transaction token. Conditional failures cannot partially increment another counter. Reservations are not refunded after failures, cancellation or uncertain transport outcomes. This may underuse the allocation but cannot create a retry-based budget credit. A delayed rate reservation cannot dispatch after its original second ends.

Exhaustion returns safe `429 UPSTREAM_BUDGET_EXCEEDED`; a rate denial returns `429 UPSTREAM_RATE_LIMITED`. Missing, malformed, unrenewed configuration or counter-storage failure returns safe `503 UPSTREAM_BUDGET_UNAVAILABLE`. No fallback initiates unbudgeted HTTP. Detail presentation-only fallback can retain descriptive data while stripping volatile offers; private commerce reads require fresh data. The fixed window can permit a boundary burst of up to twice the configured per-second limit. It does not establish per-user fairness or protect the provider account from other consumers using the key.

## Observability

CloudWatch EMF records `search_credit_request` immediately before search HTTP dispatch and `product_detail_request` before product retrieval, alongside `upstream_request`, failures, cache hit/miss, contention, budget denial/error and rate-limited events. Renamed metrics replace misleading `paid_search_request`/`free_detail_request` labels: a search can consume a free or paid credit; the application does not know which the provider ultimately invoices. Detail retrieval is separately counted, not conflated with paid lookup. Counter reservations can exceed physical HTTP attempts after cancellation, and physical attempts do not prove billed credits.

Staged usage alarms use the new request metrics; budget/error alarms detect denials or unavailable accounting. Alarms have no notification destination unless an approved existing SNS ARN is supplied. These counters and alarms are not a dollar-denominated provider billing stop or proof of remaining allowance. Production release requires an operational owner, tested notification destination and provider usage reconciliation process. No raw queries, cursors, authorization headers, secrets or customer data are logged.

## Cache policy: OPEN P1 — BLOCKED, EXTERNAL DEPENDENCY

The [current caching guidance](https://docs.trychannel3.com/guides/caching) permits short presentational caches but says prices, availability and offers must be refreshed before display. The retained catalog search/discovery response cache stores those volatile card fields for five/ten minutes. No exemption for this storefront's cached card presentation or written provider approval has been established. A short TTL does not resolve the policy conflict.

Do not claim full provider-policy compliance or production readiness for that behavior. Obtain an explicit provider allowance or approve and implement a different card-display/freshness policy before release. This review preserves the bounded one-image cards, native cursor associations, shared cache and no-per-card-refresh-fanout constraint; it does not silently add 24 detail calls to every grid. Fresh PDP/quote retrieval and presentation-only fallback remain separate from cached card snapshots.

## Verification status

The catalog/backend/adapter suite passes75/75 locally with zero failures/skips. It covers monthly/day rollover, explicit renewal, paid opt-in, malformed runtime configuration, shared-instance budget races, conditional failure classes, unchanged identities across configuration changes, cache hits after exhaustion, expired-cache denial, stale reservations, and nonrefunded failures. Tests use synthetic HTTP/AWS transports and memory counter semantics; they are not live DynamoDB or provider billing verification. After the independent review correction below, the final75/75 tests pass with zero failures/skips. Both catalog and commerce templates pass cfn-lint1.46.0 and CloudFormation Guard3.2.1; generated-source parity and catalog JavaScript syntax pass. The exact generated sizes at this verification are57,354bytes for catalog and67,130bytes for commerce, both requiring private S3 TemplateURL rather than inline TemplateBody. These are local validations only; no upload, change set or AWS write occurred. Source changes are in `backend/index.js`, canonical `backend/build-template.cjs`, generated `backend/cloudformation.json`, `backend/catalog.guard`, and the budget/runtime/template tests. No source/frontend contract schema or cursor changes were needed.

## Material issues and second review

| Severity | Issue and root cause | Correction / evidence | Release state |
| --- | --- | --- | --- |
| P1 | Search policy defaulted to1,000 requests/day without monthly allocation or paid opt-in; names incorrectly characterized every search as paid. | `backend/index.js` budget policy/reservation/runtime configuration; `backend/build-template.cjs` zero-allocation parameters; `tests/backend-budget.cjs` allocation, rollover, concurrency and cache-hit regressions. Physical request metrics now avoid invoice claims. | Fixed in source and offline tests; not deployed. Production requires separately approved policy and reconciled allocation. |
| P1 | Invalid policy returned a handled503 before emitting a budget metric; Lambda error counts alone would not detect it. | Independent reviewer demonstrated the missing EMF path. The regression failed with zero log events; runtime now emits exactly one bounded `budget_error` event before returning503, with no environment/secret details. | Fixed in source and offline regression; alarm notification destination still requires operational approval/test. |
| P1 | Retained short search-card price/availability/offer snapshots conflict with the documented refresh-before-display guidance absent an exemption. | Current policy documented explicitly; existing bounded cards/caches preserved without unapproved request fanout or display redesign. | OPEN — BLOCKED, EXTERNAL DEPENDENCY, or a separately approved alternative card policy. |

The independent code review found no demonstrated allowance bypass or partial-increment path. Tests do not prove real AWS transaction behavior or actual account charges; approved staging must verify conditional transactions, IAM, metrics and notification delivery. Spending controls protect only requests routed through this runtime. If table data must be restored/migrated, disable upstream calls first, reconcile already consumed provider credits, preserve or seed a reviewed conservative usage baseline, then reapprove the allocation. Restoring an older counter snapshot must never silently grant fresh capacity.
