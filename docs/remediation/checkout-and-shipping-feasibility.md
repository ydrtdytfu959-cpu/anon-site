# Merchant checkout and Algeria delivered-cost feasibility

Review date: October 13, 2026. This report belongs to the remediation of `feat/anox-commerce-foundation`, starting from `7958718de6d859da1c809abef7b98e012a857973`. The release manifest identifies the final reviewed commit. This is an engineering feasibility assessment, not merchant authorization, a payment arrangement, a carrier commitment or legal/tax advice establishing an amount.

**Release verdict: checkout and guaranteed delivered totals remain blocked.** The source correctly keeps checkout disabled, records only blocked attempts and collects no service fee. The catalog/quote foundation and an available Stripe sandbox do not establish an executable merchant purchase path. No payment, merchant order, refund, transfer, carrier quote or label purchase was initiated for this report.

## Evidence and status separation

| Subject | Implemented in source / automated evidence | Real account or AWS evidence | Production or commercial conclusion |
| --- | --- | --- | --- |
| Channel3 catalog and detail | Cursor search, fresh detail/variant validation and conditional quote components exist. Local handler/browser fixtures exercise these contracts. | Saved AWS inventory identifies the existing catalog function and search route; it contains no new Channel3 detail or `/commerce/*` routes. | Catalog credentials and indexed merchant offers confer no merchant ordering authority. New detail/commerce source is staged. |
| Commerce quotes and attempts | `backend/commerce/quote.js` hydrates selected merchant/variant prices, uses exact minor units and a maximum 30-second quote life. `providers.js` disables purchasing. Attempts remain `blocked`; no order or payment is created. | The 16-route AWS inventory contains no commerce route. No authenticated live commerce transaction was tested. | Passing source tests do not establish deployed quotes, real transaction contention or a purchasable total. |
| Stripe | A disconnected signed-event/state foundation is tested with injected fixtures. No active commerce Stripe webhook route or payment-creation client is provisioned. | Read-only connected-tool inventory exposed ANOX LLC sandbox `acct_1UEgIrGWY0KU3kru`, `livemode:false`. | This proves a sandbox is available. It does not prove active merchant capabilities, participating connected accounts, a successful sandbox payment, live approval or checkout integration. |
| Legacy payment and shipping | Processed CloudFormation source contains separate sandbox payment and EasyPost test paths. | Resource metadata and processed stack templates were inspected without reading secret values. | Processed template source is not proof of the exact deployed Lambda ZIP; manual code drift was not excluded. These paths were not exercised or altered and cannot certify the new commerce design. |

Supporting local evidence is in [AWS metadata](aws-inventory.json), [legacy template inventory](legacy-template-inventory.json), [security and financial findings](security-findings.md), [Channel3 cost assessment](channel3-cost.md) and [offline quote profile](quote-profile.json). The combined release validation reports the final automated counts; this report does not relabel them as live integrations.

## 1. What can actually be integrated now

The approved source scope supports product discovery, stable product/merchant/option selection, a persistent cart, fresh read-only offer validation, an explicit breakdown of known and unknown costs and ownership-bound blocked checkout attempts. Available attribution URLs can be retained as metadata. These capabilities are useful without collecting money or claiming that an order has been placed.

The current Channel3 developer page describes programmatic checkout but marks it “Coming soon” and requests early access. That public description is not a usable account-specific purchasing contract. No authorized Channel3 Checkout API schema, access approval or merchant order API agreement was found in the reviewed project/evidence. This does not assert that no private program exists; it means AnoX has no demonstrated authorization or contract for one. [Channel3 developer page](https://trychannel3.com/developers/).

There is therefore no evidenced purchasing integration that can be activated now. Source-level read-only work and approved future sandbox contract tests can proceed, but a successful mock or Stripe-only test would still not demonstrate merchant purchasing. Browser automation, a merchant's ordinary consumer checkout URL, or access to its catalog cannot replace permission to place orders programmatically.

## 2. External approvals and agreements required

These are **BLOCKED — EXTERNAL DEPENDENCY**, not missing configuration values that may be guessed:

- A Channel3 purchasing agreement/early-access contract, or an authorized order API agreement with each merchant already within the user's approved scope. Obtain the actual API contract, sandbox access, permitted buyer/agent roles and supported destinations. Do not invent additional approved merchants or use catalog coverage as an approval list.
- The merchant and AnoX agreement must identify the seller, payment recipient, customer support owner, charge descriptor, tax/invoice responsibilities, returns and cancellation rules, and the point at which the order is successfully completed for fee recognition. AnoX remains an intermediary and does not acquire inventory for resale under this project.
- If Connect is chosen, participating merchant accounts must be onboarded with the required active capabilities and a supported regional funds arrangement. ANOX LLC's account-specific eligibility, obligations and live configuration still need verification. API design cannot decide merchant-of-record or liability obligations by itself. [Stripe charge types](https://docs.stripe.com/connect/charges), [Stripe integration recommendations](https://docs.stripe.com/connect/integration-recommendations).
- Written confirmation must establish affiliate attribution for the actual embedded purchasing path, including eligible transactions, cancellation/refund reversals and reporting. A commission field is a potential rate, not earned revenue or proof that a future purchase will track.
- Carrier/forwarder and merchant arrangements must establish the actual route to Algeria, permitted goods, parcel evidence, payer of import charges and reliable pre-purchase cost inputs. No rate or delivery commitment is inferred from an available test account.

## 3. Missing technical capabilities

The missing operational purchasing contract must support the exact selected product, merchant, condition, variant and quantity; price/stock revalidation or reservation; tax and delivery quotes with expiry; idempotent order creation; status lookup after an ambiguous timeout; cancellation/refund eligibility; and durable merchant references. A changed merchant or variant requires customer confirmation. A stock flag alone does not reserve the requested quantity.

AnoX then needs a separately approved orchestration implementation binding one customer/cart revision to a durable order and merchant operations, payment identity, exact agreed amount/currency and durable audit. It must reconcile provider timeouts, duplicate notifications, partial merchant acceptance, failed captures/transfers, refunds and disputes. The existing disabled webhook foundation is not this operational system: pending/failed refunds, chargebacks, application-fee/transfer reversal allocation and merchant compensation remain unimplemented. See [SEC-03 through SEC-05](security-findings.md).

Existing gateway deployment, real Cognito ownership verification, transactional concurrency testing, alarm delivery and operational recovery are additional release gates even if commercial access is later granted. A frontend `checkout.enabled` flag must never be sufficient to activate money collection.

## 4. Can the customer have one embedded checkout?

**Potentially, with an approved purchasing and payment arrangement; not with the evidence available today.** One AnoX review/payment screen does not guarantee one merchant order, one payment or all-or-nothing acceptance across several merchants.

| Conditional approach | What it can provide | Material prerequisite or limitation |
| --- | --- | --- |
| Authorized Channel3 purchasing service | A documented service might coordinate participating merchants behind one AnoX experience. | No usable account-specific contract or enabled API was verified. Payment settlement, fee collection, attribution and reversals must be defined by that contract. |
| Merchant order API plus a Connect direct charge | A single participating merchant receives a payment on its connected account; an application fee can go to AnoX. | Requires merchant ordering permission and active payment capabilities. Several merchants generally mean separate charges/merchant commitments; an enclosing UI cannot make them atomic. |
| Merchant order API plus a destination charge | A platform charge transfers funds to one participating connected merchant and may retain an application fee. | Platform payment responsibilities and fees differ from a direct charge; requires business approval and supported account/geography configuration. |
| Merchant APIs plus separate charges and transfers | A platform charge can fund multiple participating connected recipients. | Requires a durable allocation/reconciliation ledger and explicit platform responsibility for fees, refunds and dispute exposure. It cannot send purchasing funds to arbitrary nonparticipating retailers. |

These are alternatives for a later approved design, not a selected configuration or authorization to implement one. Stripe's charge-type and marketplace documentation describe the recipient and responsibility differences; they do not provide merchant inventory reservation or merchant order creation. Cross-border funds eligibility must be checked separately from a parcel's destination. Shipping a parcel to Algeria does not establish a supported Stripe merchant settlement arrangement. [Stripe charge types](https://docs.stripe.com/connect/charges), [separate charges and transfers](https://docs.stripe.com/connect/marketplace/tasks/accept-payment/separate-charges-and-transfers).

## 5. Funds and the exact $5 service fee

The invariant is **500 USD cents gross per successfully completed customer order, before processing expenses or refunds**, with affiliate commissions accounted for separately. The source quote emits one conditional fee for the entire quote regardless of line/merchant count. It does not collect the fee for a blocked attempt or earn it merely because a payment notification succeeds.

A future approved parent order must preserve that invariant across merchant suborders. Retrying an operation, splitting fulfillment or adding products must not create another fee. The definition and recovery behavior of partial merchant success require agreement before activation; partial acceptance must not silently count as a completed order. The current service creates no orders, so this is a release requirement rather than a claim of implemented parent-order orchestration.

For an approved single-merchant direct/destination arrangement, `application_fee_amount:500` is a candidate representation of the gross fee in a USD transaction. Whether it is added to the customer charge or funded within the contractual merchant settlement requires the approved invoice/funds model; it must not underpay a merchant without agreement. Standard separate charges/transfers use the transfer allocation to retain the agreed gross fee rather than the ordinary application-fee parameter. Any other amounts held for tax, shipping or merchant principal remain liabilities, not AnoX fee income. [Stripe application fees](https://docs.stripe.com/connect/marketplace/tasks/app-fees).

Processing expenses are separate from the 500-cent gross fee. Where the platform pays them, AnoX's net margin may be less than $5 or negative. This review does **not** increase the service fee to preserve a net margin, pass through an invented surcharge, or apply an unverified account-specific processing rate. A $150 product payment remains $150 of product payment volume regardless of the fee. Actual Stripe pricing, currency/settlement effects and any additional costs require verification against the approved account arrangement. [Stripe pricing](https://stripe.com/pricing).

Do not collect or capture the fee when the merchant purchase cannot be processed. A later design must define reservation, payment authorization, merchant acceptance and capture sequencing, and compensate partial failures without describing authorization as an earned fee. The current safest behavior remains no charge creation at all.

## 6. Refund and failure responsibilities

| Scenario | Required behavior before activation | Present state |
| --- | --- | --- |
| Merchant unavailable, expired quote or unknown stock | Reject/refresh without creating a payable order or collecting the fee; obtain confirmation for a changed price/selection. | Read-only validation and blocked attempts exist; no payment is created. |
| Ambiguous merchant/payment timeout | Reuse the durable operation identity, query the provider and reconcile before any new purchase; never assume a timeout means failure. | No live merchant/payment operation exists to reconcile. Durable source idempotency tests cover current quote/blocked-attempt operations only. |
| Some merchant suborders accepted and others failed | Apply a contract-approved completion/cancellation/refund policy, report every suborder honestly and preserve one order-level fee invariant. | Operational orchestration/compensation is missing. |
| Customer refund or cancellation | Confirm merchant eligibility and actual provider completion before updating state. Reconcile principal, taxes, delivery, fee refund and any affiliate reversal separately. | Customer refund/cancel endpoints explicitly return unsupported; they do not mutate an order. |
| Chargeback, dispute or failed/pending refund | Track the full lifecycle, deadlines, evidence and financial exposure; reconcile platform/merchant balances and receipt identity. | Not an operationally supported payment flow; disconnected event fixtures do not close this gate. |

For direct charges, disputed/refunded principal ordinarily debits the connected account, but fee payment and unrecoverable negative-balance liability depend on the approved configuration. For platform charges, Stripe debits the platform for refunds/disputes; transfer recovery requires deliberate handling. Separate-charge refunds do not automatically reverse associated transfers. Returning a payment also does not automatically refund its application fee; full/partial fee allocation must be explicit, including `refund_application_fee` or a separate authorized fee refund where applicable. These operations can fail or remain pending; a successful API request is not a reason to mark all funds recovered. [Direct-charge refunds and disputes](https://docs.stripe.com/connect/saas/tasks/refunds-disputes), [marketplace refunds and disputes](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes).

No policy is selected here for how much of the fee survives a partial return. The user's gross-fee rule permits subsequent refunds; the customer terms and merchant/Stripe arrangement must define them. AnoX needs an approved support owner, refund funding/reconciliation process, dispute response process and escalation handling before activation.

## 7. What prevents activation today

The following gates remain independently blocking: **P0** missing authorized merchant purchasing path; **P0** staged commerce/detail endpoints and required real-service verification; **P0** no verified payable delivered total; and **P1 before payment activation** incomplete payment/refund/dispute recovery, commercial responsibility/retention policy and operational monitoring. Channel3 cached search-price display authorization is a separate **P1 external dependency**, documented in the [cost report](channel3-cost.md).

A future activation proposal must identify the exact merchant/API agreement, supported account and funds pattern, approved fee/cost model, provider sandbox evidence and failure-case matrix; then obtain permission for the specific deployment and tests. This review grants none of those permissions. Legacy payment infrastructure must remain isolated until its separate review and change authorization.

## Shipping and delivered-cost readiness

### What the source establishes

`backend/commerce/quote.js:60` constructs the current cost components from exact integer minor units. Product price times quantity is a **fresh estimate**, not a merchant commitment. The AnoX fee is **conditional**. Currency conversion is a verified zero only because the quote accepts USD and performs no conversion; it makes no assertion about the customer's card issuer, DZD conversion or future settlement cost. Both `estimatedTotalMinor` and `verifiedPayableTotalMinor` remain null while required amounts are unknown. Customs/import charges also appear as potential charges on arrival.

| Component | Current evidence/status | Required input before a reliable payable/delivered amount |
| --- | --- | --- |
| Product subtotal | Estimated fresh Channel3 snapshot with exact quantity arithmetic and at most 30-second validity. | Merchant confirmation/reservation of exact variant, quantity, price and currency. |
| U.S. sales tax | Unknown; not assumed zero. | Merchant/tax-provider determination for the actual delivery/address/tax treatment and responsibility. |
| Domestic U.S. shipping | Unknown. | Actual merchant origin/destination, service, package/quantity handling and dated merchant quote. |
| International shipping to Algeria | Unknown. | Approved direct/forwarder route, actual origin and destination, reliable packed weight/dimensions, service coverage, rate currency/expiry and included/excluded fees. |
| Algerian customs/import tax and clearance | Unknown; possible charges on arrival remain explicit. | Reliable goods classification, origin/value evidence, applicable official/broker determination and agreed importer/payer responsibility. No tariff, exemption, customs classification or percentage is invented. |
| USD/DZD or settlement conversion | No conversion in current USD-only quote; other conversion cost unknown. | An approved actual FX quote and payer/settlement terms if conversion is introduced. |
| AnoX fee | One conditional 500-cent component. | A successfully completed authorized order under the agreed policy. |

No sum of known amounts is labeled a final delivered total. Arrival charges cannot be hidden as a zero-valued line or silently excluded from a guaranteed price. Any later estimate must identify its source, observation/expiry, assumptions and exclusions and remain separate from a verified payable amount.

### Legacy carrier evidence and limits

Processed `AnoX-Shipping-Core` template source includes an EasyPost **test-mode** adapter and requires supplied `weightOz`, `lengthIn`, `widthIn` and `heightIn`. Its rate/fulfillment path checks an already-paid legacy order. It therefore cannot currently supply the new commerce pre-payment landed-cost contract. A test adapter/resource is real evidence of prior shipping engineering, but no carrier rate, merchant parcel measurement, Algeria service eligibility or arrival-charge commitment was verified in this review.

The processed legacy Checkout-Core template separately uses synthetic catalog weights, a 7.5% service-fee policy and fixed shipping formula. Those sandbox policies conflict with the new exact-$5/unknown-cost contract if repurposed for real commerce. The new frontend transport rejects legacy checkout/payment fallbacks; the old resources were not modified. Processed legacy shipping source also converts rate strings with floating-point rounding; a future approved integration must replace that trusted-money boundary with exact parsing and regressions before reuse. See [legacy template inventory](legacy-template-inventory.json) and the separate legacy trust-boundary findings in the release reports.

### Evidence needed to close the shipping gate

Obtain the approved merchant/carrier/forwarder route and credentials, actual package/address evidence and authoritative tax/import inputs. Test supported and unsupported Algeria destinations, missing dimensions/weight, multiple parcels/merchants, expired rates, changed prices, unavailable services, cancellation/refund eligibility and charges payable on arrival. Bind each accepted amount and expiry to the same immutable order quote; never reconstruct a chargeable total from browser values or generic category weights.

These are dependency requirements for an explicit future proposal, not tasks executed against production. No customs liability, delivery date, parcel cost or carrier authorization is claimed. Shipping and guaranteed delivered-cost readiness remain **BLOCKED — EXTERNAL DEPENDENCY** with implementation and deployment work required after approval.
