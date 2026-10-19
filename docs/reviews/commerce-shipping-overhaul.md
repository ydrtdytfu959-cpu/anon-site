# Commerce and shipping repair evidence — 2026-10-16

## Scope and verified outcome

Local source now supports an authenticated, non-payment AnoX service request based on an owned, reviewed product quote. A saved request is visible through the existing customer orders list/detail endpoints. It is explicitly an expression of interest, not a retailer order, inventory reservation, shipping booking, or payment. The approved retailer remains the seller. The fixed fee stays 500 USD cents per qualifying order; qualification and collection trigger remain `owner_decision_pending`, and collection remains disabled.

This worker ran no AWS mutations, carrier/provider requests, secret reads, merchant purchases, payment collection, refunds, or transfers. Actual deployment, carrier-account authorization, coverage and successful live delivery are not established by the local tests. The root release report owns current infrastructure inventory, browser evidence, generated artifacts and the final whole-repository verification.

## Reproduced defects and corrections

| Severity | Defect and root cause | Correction and regression evidence |
| --- | --- | --- |
| P1 | The intended journey ended after a cost quote. `/commerce/checkout-attempts` only wrote a blocked attempt; there was no non-payment service-request record. New endpoint regressions initially returned 404. | Added JWT-protected `POST /commerce/service-requests`, strict quote/cart input binding, ownership and expiry checks, durable request record and audit, and existing owned list/detail reads. No catalog/provider call occurs during request creation. |
| P1 | Fee capability metadata selected `successful_order`, and quote text selected “successfully completed,” although the owner has not decided the fee trigger. | Capability/request metadata now uses `owner_decision_pending`, `collectionEnabled:false`; quote text says fixed $5 per qualifying order and explains pending owner approval. The regression initially observed `successful_order` instead of the unresolved state. |
| P1 | Any syntactically valid merchant domain could enter quote hydration and become supported commerce if returned by the detail provider. This bypassed the six-retailer business boundary and could consume provider detail budget. | Backend validation accepts only `nike.com`, `adidas.com`, `sephora.com`, `levi.com`, `tjmaxx.tjx.com`, `elfcosmetics.com`. Exact `www.` aliases and `tjmaxx.com`/`www.tjmaxx.com` remain accepted as the same retailers, matching catalog. Tests reject foreign and spoofed hosts before hydration and accept all 14 official host forms. Existing fixtures now use the approved domains. |
| P1 | Different tabs using different idempotency keys could create two requests for the same reviewed quote. | Quote-derived durable request ID and unique record transaction produce one request and one creation audit. A concurrent loser retries using its original key and converges on the existing record. The regression first observed two different service IDs. |
| P2 | Browser validation rejected `offer.url:null` even though the server legitimately returns a quote without an authorized attribution URL. | A null URL now preserves the usable read-only quote; non-null links must still match the documented HTTPS attribution host. No link is invented. |
| P2 | Browser product ID validation coerced numbers, and quote response checks accepted a non-hash cart binding and did not validate Algeria destination. | Require string product IDs, 64-character lowercase hexadecimal cart hash and `destination.country:'DZ'`. Tests cover these mismatches. |
| P2 | A queued quote/request could begin transport after the account changed, even though its late response would be discarded. | Check session generation and cart revision before transport as well as after the response; capture immutable idempotency keys per queued operation. Regressions observed unwanted calls before the fix and zero calls afterward. |
| P1 | Independent review found service records retained live offer URLs, commission rates and availability beyond the quote lifetime. | Durable requests now strip those fields, set availability unknown, and label captured prices `historical_estimate`. Public reads and idempotency replay also sanitize older records; the browser rejects live offer metadata in a saved request. |

The older blocked-attempt, owned merchant-order read, disabled cancellation/refund and disconnected webhook foundations remain intact. No legacy source or resource was deleted.

## Request and data contract

`POST /commerce/service-requests` accepts only `{quoteId,cartRevision,cartHash}` with the existing Cognito identity and a stable `Idempotency-Key`. It requires a customer-owned, unexpired quote. Client-supplied price, owner, payment, merchant order reference and status fields are rejected. Customer identity comes exclusively from the verified authorizer context.

The response is `{schemaVersion:1,serviceRequest:{...}}`. The record has `kind:'service_request'`, `status:'received'`, the original product/merchant/variant/quantity references and observation dates, `destination:{country:'DZ'}`, `totalMinor:null`, the quoted cost breakdown, `payment.status:'not_requested'`, `fulfillment:{status:'not_requested',tracking:[]}`, and `merchantOrderReference:null`. It makes no purchase or delivery commitment. Each price reference is labeled `priceStatus:historical_estimate` and carries `capturedAt` equal to the provider `validatedAt`. Offer URL and commission are null; availability is unknown. The product cost note explicitly describes historical estimates. Public reads and completed-operation replay sanitize earlier record formats as well. Historical prices do not become current just because a request is read later.

Requests use the existing customer-hashed DynamoDB partition and `ORDER#` collection, so list/detail authorization and pagination continue to work. There is no new table, carrier permission, payment permission, or secret permission. Request records and creation audits are retained independently of quote cleanup. A record created by another customer cannot be read or reused. Distinct-key races are protected by the unique-record condition inside the existing lease-fenced transaction. Client retries after an ambiguous network failure retain the same idempotency key, including after the quote's expiration; the server replays a completed operation before rechecking expiry.

The browser client adds `requestService(cart)`, `serviceRequestShape`, request status/error state, and discriminated service-request support in `orderShape`/`ordersShape`. It validates totals, product arithmetic, fee policy, cart binding, destination and absence of payment/shipment claims. It discards responses after account/cart changes. Older backend capabilities omit service requests and therefore normalize to creation unavailable; the frontend must gate the action on the advertised capability. The quote must be reviewed before initial submission.

The canonical commerce template defines the new exact POST route with JWT authorization and exact Lambda invoke scope. Local stage settings give it the same bounded 2 requests/second, burst 4 policy as other mutation routes. No deployment or setting update was executed.

## Shipping and Algeria findings

| Path | Evidence inspected | Current honest behavior and limitation |
| --- | --- | --- |
| Current commerce delivery costs | `backend/commerce/delivery.js`, quote integration, and all 15 existing delivery tests | Disabled `DeliveryCostProvider`; no I/O or carrier API. U.S. sales tax, U.S. shipping, international shipping to Algeria and customs/import charges remain null/unknown. Neither estimated delivered total nor verified payable total is returned. |
| Delivery evidence boundary | Measured-parcel, immutable address/contents/service references, canonical request hash, exact minor amounts, payer, assumption and 30-second expiry validation | A future approved adapter cannot cross cart/address/parcel/service boundaries, present unknown as zero, or label an estimate verified without matching evidence. Even complete fixtures do not activate checkout or guarantee a total. |
| New service request tracking | Saved request status and existing authenticated list/detail path | Only `received` and `not_requested` fulfillment are emitted. No carrier, tracking number, customs estimate or arrival date is fabricated. There is no carrier status update writer in this change. |
| Existing merchant-order tracking | `backend/commerce/orders.js` | Existing status projection retained; tracking links require trusted stored `verified:true`. No new legacy tracking authority is inferred. |
| Legacy EasyPost/USPS/UPS/FedEx | Historical source inventory dated 2026-10-12 and shipping design/release notes; no runnable carrier adapter in current checkout | Historical processed-template review described an EasyPost test adapter dependent on a paid legacy order and supplied parcel measurements. USPS/UPS/FedEx are carrier possibilities in historical design, not independently verified operational integrations here. This historical evidence is not asserted as the current deployed Lambda ZIP or current carrier coverage. |
| Legacy 7.5% and fixed shipping formulas | Existing remediation report and processed-template inventory | Historical legacy checkout policies conflict with the new fixed-$5/unknown-delivered-cost model. They are not imported by the new request flow and were not deleted or repurposed. Root owns removal of such assumptions from the intended storefront copy. |

Algeria remains the only accepted destination in the quote/request contract. Neither five-digit postal syntax nor a historical test credential proves actual serviceability. Actual measurements, merchant/forwarder route, carrier account/service eligibility, customs classification, payer responsibility, insurance/return arrangements and authenticated carrier events remain external prerequisites. A request status of “received” does not establish staff review, retailer purchase or fulfillment.

## Verification evidence

Observed expected failing regressions before corrections:

- New fee/request suite: 4/4 failed initially (`successful_order` instead of unresolved trigger and missing route 404).
- Missing URL and weak browser boundary regressions: 2/2 failed initially.
- Approved retailer regression: initially returned 201 for an unsupported merchant.
- JWT service route regression: route was absent.
- Route throttle and cross-tab duplicate regressions: 2/2 failed initially.
- Pre-transport session isolation and commission preservation regressions reproduced their specific errors before fixes.

Focused final command at handoff:

```sh
node --test tests/auth-commerce.cjs tests/commerce-client.cjs tests/commerce-service-requests.cjs tests/commerce-api-settings.cjs tests/commerce-service.cjs tests/commerce-delivery.cjs tests/commerce-money.cjs tests/commerce-persistence.cjs tests/commerce-runtime.cjs tests/commerce-webhooks.cjs
```

Result: **118 tests, 118 passed, 0 failed, 0 skipped**. Log during this session: `/tmp/anox-commerce-retention-focused.txt`. Three focused infrastructure assertions (JWT service route, existing API ownership and scoped role) also pass against the generated in-memory template; syntax and whitespace checks pass. These are local real-source tests with a transactional memory adapter and injected AWS transports, not live DynamoDB/carrier/provider verification.

The complete `npm test` suite was also run while collaborators were still editing and before root regeneration: **322 tests, 315 passed, 7 failed, 0 skipped**. Failures were:

1. `Astra presentation catalog accepts only the four approved brands or explicit retailer evidence` — catalog policy expectation under active catalog repair.
2. `Non-Nike stores cannot be silently replaced with CJ Nike products` — changed catalog request behavior under active catalog repair.
3. `production HTML embeds the canonical adapter and a valid CSP hash` — generated HTML parity pending.
4. `full client bundle is deterministic, canonical and protected by the actual inline CSP` — generated client parity pending.
5. `commerce template and inline runtime are reproducible and syntactically valid` — generated commerce template pending.
6. `archive plus separate HTML retains every source needed by the real canonical build checks` — generated source parity pending.
7. `staging routes all bind the isolated API and private routes use only staging JWT` — expected route count needed the new service route.

These failures were reported to the root owner; none is represented here as waived or as an eventual final pass. The root's final build, check, full tests and browser verification supersede this intermediate suite run. Generated snapshots were deliberately left to root to avoid competing writes.

## Remaining release conditions

- The new route and UI require the reviewed release deployment; an older capability response keeps service-request creation unavailable.
- An actual authenticated staging verification must cover CORS, identity isolation, DynamoDB conflicts and retained-record reads. Local fakes do not establish AWS behavior.
- The owner must decide qualification, fee trigger and any collection policy before payment implementation. This change collects nothing.
- Merchant purchasing permissions, provider licensing and a carrier/forwarder route remain separate requirements. Catalog access does not grant purchasing authority.
- No carrier events update new requests, and no operational staff review queue or review SLA is claimed. This change closes request submission and customer visibility, not live fulfillment.
- Retained service records need the existing customer-data retention and operational support decisions before release. Rollback should restore the previous reviewed artifacts and route configuration while retaining customer records and audit/idempotency state; do not delete those records as a workaround.

## Independent catalog review handoff

Read-only review of the active catalog diff found a reproducible P2 traversal-cache defect: a continuation page is persisted after deduplication against one traversal, but the page key omits that traversal state. After the initial page expires and refreshes, a reused provider token can return a still-fresh continuation already filtered against the prior chain. Offline real-handler reproduction: initial page `[a]`, later page `[a,b]` persisted as `[b]`, refreshed initial page `[c]`, continuation still `[b]`; valid `a` disappears and is incorrectly reported as a duplicate. Reproduction script during review: `/tmp/anox-review-cursor-chains.cjs`. The finding and suggested traversal binding or independent-page normalization were sent to the root/backend owner; this reviewer made no backend catalog edits. Final resolution belongs in the root report.

A further existing gallery inconsistency was flagged for the catalog owner: search accepts a safe `cleaned_url` when the original image is unusable, while detail normalization still required the original URL. This can show a card image that disappears on detail. No provider/production request was used to reach either finding.

### Retention review correction

Three backend regressions first failed by exposing live attribution URLs in a new durable record, a seeded older record, and an older completed idempotency response. A browser regression also failed because historical price metadata was missing. The correction projects historical reference fields before persistence and every service response, preserving identity/options/quantity and captured estimate amounts while removing current offer URLs, commissions and stock claims. The browser now rejects saved requests with live offer data, absent historical labels or malformed captured timestamps. The focused suite after this correction is 118/118 passing. No provider or production request occurred.

### Final integration corrections — October 17

Definitive quote_expired/409, quote_not_found/404 and cart_changed/409 responses clear the rejected service body/key; refreshed quotes can then be submitted. Uncertain failures retain the original idempotent retry identity. Explicit retryability drives the UI so a rejected quote asks for fresh reviewed costs rather than looping a disabled operation. English/Arabic fee badges leave the trigger pending. A screenshot-discovered price notice flex defect is repaired with scoped CSS and a browser geometry regression. The complete final validation is377/377 Node and72 browser groups; see the root release report and dated logs.
