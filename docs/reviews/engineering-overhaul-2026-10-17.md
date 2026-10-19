# AnoX engineering release review — October 17, 2026

## Release scope

Branch `fix/anox-engineering-overhaul-20261016` continues baseline `c6c58956ebc28f61f32509f0848f115907d31a7a`. The existing Astra storefront, account infrastructure and deployment structure are preserved. This candidate repairs discovery, failure recovery and customer service-request submission. It does not enable merchandise purchasing, payment collection or live Algeria shipping.

Preserved commits:

- `cd70159`: approved-retailer discovery, catalog regression coverage and authenticated non-payment service requests.
- `c05e3e9`: bounded CJ warmer, verified original Lambda source, reproducible candidate/rollback packages and exporter compatibility.
- Subsequent review corrections are recorded in the final branch history and checkpoint.

## Repairs and source ownership

| Customer or operational defect | Root-cause correction | Principal source / regressions |
|---|---|---|
| Store pages used broad retailer-name searches despite backend support for exact official domains. | Carry exact `website_ids` through request construction, validation, caching and merchant checks. Scope generated category queries as well as retailer pages. | `catalog-live.js`, `backend/index.js`; `catalog-overhaul`, `adapter-cursor`, `backend-catalog` tests |
| Genuine official products, including retailer-sold sub-brands, disappeared. | Merchant evidence determines eligibility independently of brand text; retain safe image alternatives and image-less products without fabricating imagery. Preserve all fourteen aliases for the six retailers. | Catalog adapter/backend; merchant spoofing, alias crowding and gallery regressions |
| Pagination repeated or lost products, including after a first-page refresh. | Bound raw traversal; retain cursor/ID history; bind cached continuations to traversal generation; deduplicate mixed-page display slots without discarding unconsumed records. | Adapter/backend cursor/cache tests |
| Jeans became accessories because a broad parent category won. | Prefer the specific category leaf before broad ancestry. Historical live evidence is retained unchanged. | `catalog-live.js`, `tests/catalog-overhaul.cjs` |
| Outages looked like empty stores; a failed retailer suppressed healthy sources. | Classify budget, rate, cursor, provider and rejection failures independently. Retain permitted presentation data for at most one hour with explicit degraded status and no stale price, stock, offer link or continuation. | Adapter/backend cache/transport tests and browser catalog suite |
| An enabled cache-warmer schedule returned 404 while Lambda reported success. | Support the exact existing scheduled event; one fixed CJ Nike page, bounded writes/retries, failures surfaced as failed invocations, merchant validation and safe errors. | `backend/legacy-catalog`, `tests/legacy-catalog.cjs` |
| The service fee assumed an unapproved “successful order” trigger. | Keep the proposed fixed $5 fee with `owner_decision_pending` and collection disabled; neutral English/Arabic fee badge. | Commerce provider/client/UI and service/storefront tests |
| The journey had no durable non-payment request after a reviewed quote. | Add JWT-protected, customer-isolated, idempotent request creation and existing owned order reads; gate UI on deployed capabilities. No purchasing or payment operation is added. | `backend/commerce`, `commerce-client.js`, `auth.js`, generated templates and browser commerce suite |
| Old service requests could expose expired live offers and stock claims. | Persist historical estimates with capture timestamps; strip offer URLs/commissions and mark availability unknown, including older-record reads and completed idempotency replays. | Service-request/client regressions |
| A rejected expired quote was retried forever, even after refresh. | Clear retry identity only for exact definitive pre-commit server rejections; preserve original body/key for uncertain failures. | Client regression tests |
| Gallery/detail and cart/session edge cases could misrepresent selections. | Safe cleaned-image fallback; preserve distinct variant identities, explicit merchant/option selection, pending-response session isolation, persistent cart and truthful quote/availability expiry. | Detail, auth, commerce and desktop/mobile browser tests |

Detailed component evidence: [catalog](catalog-backend-overhaul.md), [commerce and shipping](commerce-shipping-overhaul.md), [legacy warmer](legacy-catalog-overhaul.md). Earlier failing integration snapshots in those reports are historical; the final validation record below is authoritative for this candidate.

## Measured retailer coverage

The bounded production smoke on **October 16, 2026, 13:22 UTC** made six searches and six details, using the deployed API and repaired local adapter. It did not deploy the candidate. Each search used its exact official domain and returned HTTP 200. Each sampled detail returned HTTP 200, a description, gallery and verified offer.

| Retailer | Returned records | Accepted records | Rejected | Sample detail images / option groups |
|---|---:|---:|---:|---:|
| Nike | 16 | 16 | 0 | 1 / 2 |
| Adidas | 5 | 4 | 1 unverified merchant | 7 / 1 |
| Sephora | 18 | 18 | 0 | 7 / 0 |
| Levi's | 20 | 20 | 0 | 5 / 1 |
| TJ Maxx | 24 | 24 | 0 | 1 / 0 |
| e.l.f. Cosmetics | 5 | 4 | 1 unverified merchant | 8 / 0 |

These are **86 accepted records from 88 first-page records**, not an exhaustive inventory or cross-retailer unique-product count. All six pages had continuation. Missing variant groups remain missing. The deployed backend did not expose pre-normalization rejection diagnostics, so earlier upstream losses are unknown. No claim of comprehensive inventory, current stock, price durability or retailer ordering authority follows from this smoke. [Timestamped evidence](../evidence/retailer-coverage-2026-10-16.json).

Channel3 official-domain discovery is the verified strategy for all six stores. CJ remains a separate Nike-only fallback. The optional CJ TJ Maxx adapter remains authorization-gated and inactive. The legacy table's 982 persisted Nike records do not prove current browse availability or six-store coverage.

## AWS compatibility and budget controls

Read-only inspection covered the actual us-east-2 HTTP API, 22 routes, 15 Lambdas, eight tables, execution roles, schedules and bounded diagnostics. The deployed catalog supports official-domain filters; all six actual requests succeeded. Production HTML initially matched the baseline byte for byte. [AWS evidence](../evidence/aws-audit-2026-10-16.md).

At the verified post-smoke snapshot, the monthly free-search ceiling remained **500**, daily search ceiling **60**, detail monthly ceiling **200**, paid allowance **0**, paid usage **false**. Counters were 66 searches and 42 details, leaving 434 / 158 at that timestamp; October 16 daily use was six searches and six details. The owner's reported provider balance is not treated as independently verified. Other applications sharing credentials can consume provider credits outside these counters. Consult the audit's latest dated snapshot before any further metered test.

Version 3 invalidates old catalog pages/cursors without changing period-based budget keys. Deployment must use existing CloudFormation parameter values, preserve the tables and historical counters, and retain all approved caps. Template defaults deliberately fail closed; they are not permission to replace live allocation parameters. The October allocation does not automatically renew in November.

A fresh readback at **October 17, 12:49:35 UTC** reconfirmed all limits unchanged, with **86 searches / 44 details consumed, 414 / 156 remaining**. The intervening increase of 20 searches and two details is unattributed; this continuation made no additional provider calls. CloudFormation remained UPDATE_COMPLETE and Lambda Active/Successful.

The actual legacy Lambda package was retrieved and hash-verified. It is CJ-only; unused Channel3 secret access is standing permission, not a demonstrated fallback call path. The original source is immutable in the repository, with reproducible rollback packaging. No secrets were retrieved and no infrastructure was changed.

The new commerce route, generated JWT/throttle configuration and additive catalog response contract are tested locally. An older deployed capabilities response safely keeps request submission unavailable. New route behavior is not claimed to have run in deployed AWS.

## Final validation

Node v24.18.0, npm 11.16.0, Playwright 1.63.0. All five required commands exited 0. The full Node suite passed **377/377**, with zero failed/skipped; Chromium and Firefox passed **72 browser groups** (20 catalog + 52 commerce across desktop/mobile), including 135 existing storefront self-tests per catalog engine. Canonical templates, embedded clients and CSP hashes match. [Exact commands, source hashes and full logs](../evidence/validation-2026-10-17/command-results.json).

Visual review of eight fixture screenshots caught a price-change notice split into narrow flex columns. A scoped CSS fix preserves inline amounts; the new browser geometry regression failed before the fix and passes on both engines and viewports. These images use deliberate placeholder product imagery and do not prove real image-provider availability.

Required commands: `npm ci --ignore-scripts`, `npm run build`, `npm run check`, `npm test`, `ENGINES=chromium,firefox npm run test:browser`. Browser tests run the actual bundled HTML/CSP with injected external boundaries, including desktop/mobile, galleries, cart persistence, sessions, quote expiry and request tracking. They make no real provider or payment calls.

## Owner-reviewed deployment and remaining dependencies

1. Review and approve the PR before deployment; this work neither merges nor deploys. Reconfirm live code/configuration drift and save rollback artifacts.
2. Preserve current CloudFormation parameters, physical tables, customer/audit/idempotency data and spending counters. Review the changeset for replacements or permission expansion. Apply the compatible backend/routes before relying on new frontend capabilities.
3. Run authenticated staging acceptance against real JWT/CORS/DynamoDB boundaries and two test accounts before production rollout. No provisioned staging environment or customer test credentials were supplied for this run; local tests do not establish those live boundaries.
4. The legacy warm repair is a separate code package. Enabling its formerly ineffective existing schedule causes actual CJ requests. Review existing async retries and CJ permission/usage, then use the module's documented owner-approved deployment and rollback process.
5. The fee qualification/trigger, purchasing/payment arrangements, retailer permissions and live Algeria carrier/forwarder route remain commercial or external dependencies. Payment and purchasing remain disabled; shipping/customs/delivered total remain unknown. A received service request does not imply fulfillment, a staff queue or a review SLA.
6. Read-only audit identified unused legacy credential permissions, weak uptime coverage, stale regional alarm context and absent catalog log retention. Those live infrastructure settings require a separate reviewed owner-approved change; they were not silently modified by this release.

Rollback restores saved code/templates/frontend while retaining data and counters. A catalog rollback invalidates incompatible cursors and requires a browse restart; returning to the verified legacy source also returns its known warm-404 limitation. New service records remain clearly non-payment records and must not be deleted to make an older interface appear compatible.
