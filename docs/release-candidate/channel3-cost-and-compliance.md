# Channel3 cost controls and presentation-cache compliance

Reviewed October 13, 2026, on `feat/anox-commerce-foundation`, starting at `dd11ddedf277d74446d77af6836a67ee30abebf7`. This report supersedes the open card-policy choice in the prior remediation assessment. Changes described below are source changes and local evidence, **not deployed policy, approved spending, account billing reconciliation or written provider authorization**. No provider call, API key retrieval, AWS mutation or paid allocation was performed for this work.

## COST-03: corrected source policy

Channel3's [caching guidance](https://docs.trychannel3.com/guides/caching), re-read for this release, allows short presentational caches for titles/images while requiring fresh volatile prices, availability and offers before display. We therefore removed those volatile fields from cached discovery cards. This is an implementation of the published guidance, not an exemption negotiated with Channel3.

`backend/index.js` now stores only bounded product identity, title, description, brands, category, key features and one primary image in a search-page record. It drops offers, their prices/discounts/buy URLs, all stock and variant snapshots. It does not substitute a zero price or fabricated options. `catalog-live.js` independently ignores volatile fields even if an older server sends them, emits a strict presentation-only record with null price/stock, empty variants and no merchant link, and preserves its actual presentation-fetch time. The core admits this form only for Channel3 live presentation records; Nike/CJ normalizers and strict priced-record rules remain intact.

Cards and suggestions say to check current price on the product page. Category/brand discovery remains usable; price/availability/size/color controls are unavailable for these cards. Old price/selection-filter URLs show a limitation and a clear-filters recovery action, rather than interpreting null as free or pretending to verify stock. Price-based navigation has honest discovery labels outside the isolated demo mode. Native pagination, section independence, stable-ID deduplication, stale-response cancellation and the one-image/pixel protections are unchanged. No per-card network calls are added.

Opening a product deliberately requests fresh detail. Existing concurrent detail coalescing only reuses retrievals already in flight when the consumer began; the 30-second exchange is not a general sequential response cache. Public descriptive fallback strips all volatile offers; quote hydration cannot use fallback. A product view/quote still conveys neither stock reservation nor merchant purchasing authorization. Any future return to cached card-price display needs a separately reviewed design or explicit written provider permission covering exact fields, TTL, refresh semantics, channels and plan. That permission is not established here.

Search presentation TTL remains five minutes; category discovery ten minutes. These bounded reuse periods limit repeated paid discovery calls while avoiding a long-lived product-content mirror. Opaque native `page_token` associations remain context-bound for 30 minutes, including query, filters, section, limit and schema. Schema version 2 excludes pre-policy full-card cache entries. Old cursors explicitly fail and require deliberate restart; they never cause an automatic first-page credit. The `budget#...` and `rate#...` financial counters do **not** include the presentation version and are not reset by this change.

**Compatibility gate:** the older frontend requires offers to normalize a card, so it cannot consume the new response. New frontend code can consume either backend representation safely. Use an approved coordinated release/maintenance sequence; do not install the new search runtime under an old public frontend and call an empty storefront success. Additive detail/commerce dependencies must be available before releasing dependent pages. Rollback must preserve the presentation-only policy and spending counters; reverting to the old cached-price runtime is not a compliance-safe automatic rollback.

## Provider tariffs and unresolved account facts

The [current public pricing page](https://docs.trychannel3.com/pricing) lists 1,000 free monthly credits, then $0.007 per additional credit. Search requests, including continuation pages, consume one credit. `/lookup` is a separate paid endpoint; AnoX uses product retrieval, listed as free, instead. Public [rate limits](https://docs.trychannel3.com/faq/rate-limits) list a default key quota of 10,000 requests/day, shared across endpoints; most/search endpoints have 10/s, lookup 5/s. Free product retrieval still consumes request capacity. These are separate constraints.

The actual ANOX plan, billing period/timezone, unused credits, charged-failure semantics, other applications, promotional/account-specific terms and invoice remain **unverified**. No dashboard balance or invoice was inferred from a sandbox, AWS environment or internal count. If the public tariff and ANOX contract differ, use the contract. Obtain account evidence through an authorized operator before allocating any free or paid usage. Do not assume the first 1,000 requests made by this Lambda are free.

## Budget and abuse behavior

The existing remediation controls remain fail closed: current explicitly approved UTC allocation month; zero default search/detail allocations; separate paid opt-in; atomic month/class, day/class, shared-day and shared-second reservations. Limits are total permitted reservations, not additive top-ups. Configuration changes cannot change counter identities. Month rollover requires approval and reconciliation instead of assuming an automatic free renewal. Failed, cancelled and ambiguous attempts do not refund capacity. AWS retries reuse transaction identity; Channel3 HTTP requests are not automatically retried.

Fresh presentation-cache hits work with exhausted allocations. Once their TTL ends, an unapproved/exhausted catalog becomes unavailable with deliberate retry UI. This is intentional protection, not an operating configuration: **Release A needs an approved nonzero search allocation and separate detail-request allocation before users can browse normally.** Approve a bounded pilot based on measured demand; do not change zero defaults simply to make a smoke test pass. Treat predicted demand above allocations as expected admission/throttling failures, not invisible borrowing of more credits.

Random anonymous queries can exhaust an approved allocation even while identical queries coalesce. CORS is not abuse prevention. Route throttles, bounded query lengths/page size/traversal, shared cache/leases, fixed-window rate limits and atomic budgets limit service/provider work; they do not guarantee fair customer access or prevent all AWS request charges. Fixed second windows can burst across their boundary. A full rate/identity/challenge policy should be chosen from measured anonymous traffic and existing edge architecture before increasing allocations; no unapproved infrastructure was introduced.

Any positive paid allowance requires explicit approval and `PaidUsageEnabled=true`; the flag alone grants none. At the public rate, an incremental allocation of 1,428 credits corresponds to at most $9.996, 3,571 to $24.997, and 14,285 to $99.995 in list search-credit charges **for this service only**, assuming each counted attempt costs one credit. These are review thresholds, not enabled configurations or a provider invoice guarantee. Reapproval is needed before increasing the approved amount, changing the allocation month, migrating counters, changing consumer scope or accepting a tariff change. Even a one-credit paid allocation is a spending decision.

## Monitoring and recovery

Physical `search_credit_request` and `product_detail_request` metrics distinguish endpoint calls without guessing invoiced free/paid status. Cache hit/miss, contention, failures, rate denials, budget denials and budget-storage errors remain separate bounded EMF events. Reservations may exceed physical dispatch after cancellation. Logs omit queries, cursors, payloads, headers and customer/credential data. Production defaults to `AnoX/Catalog`; approved staging uses `METRIC_NAMESPACE=AnoX/Staging/Catalog`. Any other namespace fails closed instead of mixing staging usage into production metrics.

The five catalog alarms require an approved SNS destination, tested delivery and a named operational owner. An alarm defined in source is not an operational notification. Monitor request counts, budget denials, provider failures, hit ratio and allocation consumption; reconcile periodically to provider reporting and investigate differences rather than equating counters to billing. Alarm review and monthly allocation ownership remain release prerequisites.

PITR/deletion protection and retained tables are staged. **Never recover budget capacity by deleting or restoring counter rows.** Before restore/migration, stop all upstream consumers through a reviewed fail-closed configuration; verify no requests can dispatch, preserve current counters and provider usage evidence, then restore into a separately reviewed table. Reconcile already spent credits and conservatively retain/seed usage at least as high as the last known reservation baseline. Unknown consumption means zero new allowance. Only after an independent operator reviews reconciliation may the current month and bounded limits be reauthorized. Do not roll back to a pre-budget runtime to recover service. Detailed deployment tooling/runbook supplies the approved-change boundary.

## Shared credential bypass: not yet closed in AWS

The saved IAM inventory identifies both the dedicated Channel3 runtime and `AnoX-Catalog-API-Role` as readers of the same production secret. Therefore the new counter is **not an account-wide spending boundary**. Restricting only the new Lambda cannot solve this. Review all role, resource-policy, user/integration and function-invocation paths again before cutover; the earlier nine-role capture did not by itself cover every possible AWS or non-AWS consumer.

The separate [consumer isolation proposal](channel3-consumer-isolation.md) prepares a narrow legacy-secret denial while preserving CJ/product access and historical data. It must follow dependency/IAM/route inventory and an approved drain of old workers, including any cached key holders. It has not been applied. Remaining consumer scope, provider key use outside AWS and provider-side account controls require an operator decision; no source-only change can attest those closed. Keep COST-04 open until approved isolation and real rejection/counter evidence are collected.

## Reproducible monthly demand scenarios

Run `node scripts/channel3-cost-model.cjs` to reproduce [channel3-cost-scenarios.json](channel3-cost-scenarios.json). This offline planning tool has no network or configuration-write capability. Traffic assumptions are scenarios, not measured user behavior. Each continuation is a page request; two selected product-option snapshots are refreshed per modeled quote. Details count separately from credit-bearing search. Coalescing of fresh detail is conservatively ignored. Cache rates represent reuse within the actual five/ten-minute lifetimes, not a claim that all monthly users share one cache response.

| Scenario | Pages/user/month | Page cache hits | Detail opens/user/month | Quotes/user/month |
|---|---:|---:|---:|---:|
| Best | 10 | 85% | 4 | 1 |
| Base | 24 | 50% | 10 | 2 |
| Stress | 60 | 10% | 30 | 5 |

The best scenario needs concentrated repeat discovery traffic; at low MAU it is optimistic. The stress scenario models fragmented searches and more revisits, not a complete malicious-traffic ceiling. MAU alone cannot forecast invoice costs.

| MAU | Scenario | Search credits demanded | Detail requests | Channel3 USD with 1,000 unused free credits | USD with no free balance | Modeled AWS core subtotal USD |
|---:|---|---:|---:|---:|---:|---:|
|100|Best|150|600|0.00|1.05|5.54|
|100|Base|1,200|1,400|1.40|8.40|5.82|
|100|Stress|5,400|4,000|30.80|37.80|6.78|
|1,000|Best|1,500|6,000|3.50|10.50|6.81|
|1,000|Base|12,000|14,000|77.00|84.00|9.56|
|1,000|Stress|54,000|40,000|371.00|378.00|19.25|
|10,000|Best|15,000|60,000|98.00|105.00|19.46|
|10,000|Base|120,000|140,000|833.00|840.00|46.96|
|10,000|Stress|540,000|400,000|3,773.00|3,780.00|143.87|

These are **unconstrained demand**, not amounts the zero-default release will spend. The 10,000-MAU stress case demands about 31,334 provider requests/day on average, exceeding the documented default 10,000/day and the staged detail monthly maximum. The base case averages 8,667/day, leaving little burst/day-skew margin. Existing default shared cap is only 1,000/day, so these traffic levels require an explicit capacity and cost decision; none is automatically enabled. Peak requests, retry-after behavior and latency need approved real-service measurement.

AWS assumptions are transparent core-service estimates, not a retrieved Ohio price-list/account quote. The model uses 256 MB Lambda, 0.1-second cache hits, two-second provider reads, four-second quote execution, 64-KiB page/detail payloads, transaction-expanded DynamoDB write units, and pessimistically one secret read per upstream attempt. It includes 15 custom metrics/five standard alarms and five KiB logs/invocation. The model deducts no AWS free tier; processing layers are counted separately, including private catalog Lambda calls made by quotes.

Official pricing examples support the illustrative rates: [Lambda](https://aws.amazon.com/lambda/pricing/) $0.20/million requests and $0.0000166667/GB-second x86; [HTTP API](https://aws.amazon.com/api-gateway/pricing/) $1/million first-tier requests; [DynamoDB](https://aws.amazon.com/dynamodb/pricing/) $0.625/million writes and $0.125/million read units; [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/) $0.30/custom metric-month, $0.10/standard alarm and $0.50/GB log ingestion; [Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/) $0.40/secret-month and $0.05/10,000 calls. Reprice the actual region/configuration before approval.

The AWS subtotal excludes data transfer, storage/PITR/restore, retained/query logs, SNS, Cognito, artifact S3, other applications, taxes and account discounts. The JSON supplies modeled response volume and per-component arithmetic to add those charges. Example DynamoDB storage/backup size must be measured from retained cache/counter/commerce data, not invented from MAU. AWS infrastructure quota increases do not purchase Channel3 credits; both decisions are separate.

## Evidence and remaining gates

Observed regressions failed before corrections: cached offers retained; adapter interpreted cached price; core rejected null-price cards; browser failed honest price text; staging EMF polluted the production namespace. Corrected focused catalog/cache/adapter/repository/runtime tests passed 66/66. Cost-model tests passed 3/3. Chromium and Firefox catalog checks passed 20/20 groups with 135 embedded self-tests per engine; [raw browser output](catalog-browser-results.txt) is fixture evidence, not AWS/provider verification. The first full concurrent `npm test` run had three generated-file parity failures while other source owners were still editing; the root release validation must rebuild all canonical outputs and record the final combined result. No failure is exempted.

COST-03 source correction is ready for independent review; it is not deployed. Operational release still requires approved allocation, all-consumer isolation/reconciliation, backend/detail deployment, coordinated frontend compatibility, real conditional-write/metrics evidence and tested notifications. The provider plan, actual invoice and commercial purchasing permission remain external facts, not passing-test outputs.
