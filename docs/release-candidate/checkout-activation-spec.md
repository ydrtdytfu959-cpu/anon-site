# Authorized unified checkout implementation specification

Status: **BLOCKED — EXTERNAL APPROVAL**. This is a conditional implementation contract for Release B, not an enabled feature. Release A continues to show `checkout.enabled:false`, rejects browser activation flags, creates no merchant order/payment and collects no fee. No merchant API endpoint, authorization or approved brand is invented.

The original retailer remains the seller; AnoX is an intermediary, not an inventory reseller. Exactly one conditional500USD-cent gross fee applies to a successfully completed customer order, before processing expenses/refunds. Affiliate income remains unrecognized until independently confirmed. The existing [feasibility report](../remediation/checkout-and-shipping-feasibility.md) establishes why catalog access and ANOX LLC's Stripe sandbox do not authorize purchases.

## Decision and evidence prerequisites

| Decision | Required evidence and owner | Engineering consequence |
| --- | --- | --- |
| Purchasing route | Channel3 or each already-approved merchant provides written ordering authorization, versioned API/sandbox contract, destinations and supported goods. | Implement only documented reserve/create/get/cancel/refund operations supported by that contract. No browser automation or undocumented checkout endpoint. |
| Seller/payment roles | Merchant, AnoX and payment provider agree seller/merchant of record, descriptors, tax/invoice responsibility, support and negative-balance liability. | Record explicit roles per merchant. A platform charge does not silently make a nonparticipating retailer a Connect recipient. |
| Payment arrangement | Participating merchant onboarding and account capability evidence, approved regions/currencies/funds route, fee payer and liability configuration. | Runtime checks eligibility before authorization and again before purchase/capture; dashboard availability is insufficient. |
| Completion and fee | Approved definition of successful customer order, partial acceptance policy and full/partial return policy. | One fee ledger entry per parent order, never per line/retry/suborder. Do not recognize it merely on payment success. |
| Delivered-cost commitment | Verified item, tax, domestic/international shipping, insurance if selected, FX if any, and customs responsibility with exact expiry. | Missing mandatory amounts block payable totals. Arrival charges cannot hide inside a supposedly guaranteed landed price. |
| Attribution | Provider/merchant confirms tracking permitted through this exact embedded path and refund/reversal reporting. | Preserve permitted references, log no tracking/customer secrets, accrue only confirmed affiliate earnings. |

Current public Channel3 developer material still advertises checkout as early-access/coming-soon material rather than establishing an account-specific production ordering contract. Obtain written eligibility and the actual supported contract. [Channel3 developers](https://trychannel3.com/developers/).

## Payment-pattern alternatives without changing the business model

A single participating merchant with a direct charge is the clearest candidate for retaining that merchant as merchant of record; it still needs an authorized merchant-order API and agreed fee funding. Destination or separate charges/transfers place obligations on the platform and require a reviewed `on_behalf_of`/settlement arrangement where supported. Connect cannot pay arbitrary retailers simply because their products appear in the catalog. [Stripe charge types](https://docs.stripe.com/connect/charges), [supported configurations](https://docs.stripe.com/connect/configuration-migration-guide).

For several merchants, distinguish **one AnoX checkout interface** from **one underlying payment**. Multiple merchant direct charges can share a coordinated UI but are separate authorizations and cannot be assumed atomic; customer consent/statement disclosures and failure compensation must be agreed. A single platform charge split to multiple connected recipients may conflict with the required original-merchant payment roles; one settlement-merchant field cannot establish all merchants' commercial roles. Do not select that design just to obtain one charge. An authorized purchasing intermediary may offer another supported arrangement, but its actual contract must supply the guarantees. No funds model is selected by this specification.

In an approved USD direct/destination arrangement, `application_fee_amount:500` may represent the gross AnoX fee. The agreed payable and settlement allocation must fund it without reducing the merchant's contractual principal. Separate-charge arrangements generally retain the agreed amount through allocations rather than the ordinary application-fee field. Processor fees are recorded separately: net AnoX proceeds can be less than$5. No surcharge or percentage increase is introduced. [Application fees](https://docs.stripe.com/connect/marketplace/tasks/app-fees).

## Server contract to implement after authorization

Keep the currently disabled `CheckoutProvider` as the default. A real adapter must declare a versioned server-only capability record backed by recorded approval and account status, not a browser flag. Proposed adapter operations are internal interface names, **not claims of merchant API endpoints**:

- `reserve(selection, delivery, operationContext)` → provider reference, exact guaranteed amounts/currency/quantity, expiry and cancellability; unsupported reservation is explicit.
- `createOrder(reservation, operationContext)` → `accepted | rejected | unknown`, immutable merchant reference when known, accepted selection/amount and lookup identity.
- `getOperation(operationContext)` / `getOrder(reference)` → authoritative reconciliation result; unknown stays unknown.
- `cancelOrder(reference, operationContext)` / `refundOrder(reference, allocation, operationContext)` → eligibility plus pending/succeeded/failed result and provider reference. API acceptance is not completion.

Context binds owner partition, parent order, merchant suborder, accepted quote/cart hash and revision, operation type, canonical payload hash and a durable idempotency key. It includes neither a browser amount nor arbitrary destination URL. Adapter endpoints are fixed allowlisted HTTPS origins; redirects are rejected. Bound response bytes/deadlines, validate identifiers/options/currency/decimals and sanitize public errors. No generic payment or merchant passthrough route.

Use a durable operation/outbox/reconciliation design in a separately reviewed implementation. Conditional claims and audit writes precede dispatch. Store request fingerprint and provider idempotency/lookup identity before the network call. If a lease expires or response is lost, a successor first reconciles the same operation; it does not create another purchase. Retry only within documented provider idempotency lifetime. Never delete a financial claim on a24-hour cleanup schedule. Durable record retention, PII erasure and access policy require approval before activation.

## State and orchestration invariants

Keep parent order, merchant suborder, payment, delivery and fee states separate. Suggested future state vocabulary is a specification, not current supported order enums: parent `validating → awaiting_customer_confirmation → authorizing → placing → reconciling → confirmed | failed | manual_review`; merchant operation `reserved/accepted/rejected/unknown/cancel_pending/canceled`; fee `conditional/earned/refund_pending/refunded`.

1. Rehydrate exact product/variant/condition/merchant/quantity and all required costs. Reject unknown or unavailable inventory. Catalog InStock is not a reservation. Obtain fresh provider commitments; their earliest expiry bounds authorization.
2. Show every line and all required amounts/currency/expiry plus conditional500-cent fee. Bind the customer's explicit acceptance to the complete server quote/version. Any amount, merchant, variant, quantity, delivery mode or responsibility change invalidates acceptance.
3. Sequence stock reservation, payment authorization, merchant acceptance and capture according to the approved contracts. If the purchasing API cannot reserve or safely reconcile ambiguous orders, do not activate an irreversible capture-before-order path as a workaround. Capture limits and authorization expiry vary by payment method/provider; use actual provider fields, not an assumed fixed window. [Stripe authorization and capture](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method).
4. One durable payment identity belongs to one accepted operation. Customer redirects, browser storage, forged event objects and payment success alone cannot confirm a merchant order.
5. Parent confirmation requires all required merchant commitments and verified successful payment under the approved partial-success policy. A partially purchased cart is never silently reported failed or complete. Reconcile, cancel/void/refund or escalate every child operation explicitly.
6. Recognize the single500-cent gross fee only at the agreed successful-order milestone. A blocked/failed order earns no fee. If money was captured before a later failure, record the actual refundable liability and compensation status; never erase the charge from history or mark refund complete before provider confirmation.
7. Persist shipment handoff only from accepted merchant records. Actual parcel/tracking provenance and importer responsibility must survive the handoff. No legacy synthetic weight/rate is promoted into a new order.

## Webhooks, refunds and audit

Before exposing any new financial webhook, verify signatures over exact raw bytes, enforce documented timestamp/replay rules, support controlled signing-key rollover and bind event account/environment to the approved integration. Fetch provider state through a fixed authenticated adapter when a delivery cannot establish authoritative state. Invalid authentication must cause no reads/writes that expose customer data. The disconnected existing Stripe module is not a complete live ledger.

Persist a durable provider/account/event receipt and payload fingerprint, verify expected payment/order/amount/currency/operation binding even on replay, then atomically fence version and apply state/audit. Handle duplicate/out-of-order events, malicious same-ID different-content replay, delayed success after timeout, partial refunds, pending/failed refunds, disputes and chargebacks. Audit actor/operation/resource/version/transitions, request hash and provider reference with minimal PII; do not log tokens, secrets, addresses or full payment payloads. Reconciliation must recover events missed during downtime.

Direct-charge refund/dispute exposure and fee payer depend on the merchant configuration; platform charges generally debit the platform for refunds/disputes. Application-fee refunds and transfer reversals are separate operations, not automatic consequences of all refund types. Track requested, pending, failed and completed principal/fee/tax/delivery/transfer/affiliate reversals separately; a reversal failure does not undo the customer's refund obligation. Cap cumulative successful refunds by the original ledger allocation and serialize concurrent partial refunds. [Stripe refunds and disputes](https://docs.stripe.com/connect/charges#refunds), [separate charges and reversals](https://docs.stripe.com/connect/separate-charges-and-transfers).

## Required sandbox acceptance matrix

These are **provider-sandbox tests to prepare after credentials/approval**, not tests already executed:

| Scenario | Required evidence |
| --- | --- |
| One merchant, one/many items | Exact accepted variant/merchant/currency/quantity, merchant reference, one gross500-cent fee, customer receipt and ledger agree. |
| Multiple merchants | Approved customer experience and funds roles; all accepted vs one rejected/timeout; no duplicated fee or hidden partial purchase. |
| Modified retry / two concurrent callers | Same key+payload returns one operation; changed payload rejected; lost reply reconciles one merchant purchase/payment. |
| Price/stock/quote change | Invalidates acceptance; expired quote cannot authorize; unknown stock never fabricated. |
| Authorization succeeds, order unknown | Reconcile same operation without repeat purchase/capture; bounded manual escalation. |
| Order accepted, payment/capture fails | Contract-supported cancel/recovery path; honest pending liability/state and no earned fee on failed completion. |
| Payment succeeds, merchant rejects | Actual money remains recorded; refund/void and fee reversal verified, not inferred. |
| Signature/replay/account attacks | Bad raw signature/age/account/environment/payment binding rejected without mutation; valid duplicates harmless. |
| Partial/full refunds and disputes | Monotonic exact allocation, pending/failed handling, fee and transfer reversal responsibility, recovery after webhook outage. |
| Delivery unavailable / cost expires | No chargeable total; no guessed parcel/tax/customs. Arrival responsibility disclosed. |
| Account change/cross-owner access | No foreign quote/order/payment data or operation accepted. |

Activation requires contracts, approved roles/funds/fee/completion policy, supported merchant capabilities, actual cost commitments, durable recovery implementation, real sandbox evidence, security review, staging approval/evidence, operating ownership and explicit final deployment/payment authorization. None can be replaced by a green local test or environment variable.
