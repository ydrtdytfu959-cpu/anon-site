# Purchasing and payment readiness

Reviewed October 9, 2026. This document describes integration boundaries; it does not activate financial operations or establish a commercial agreement.

## Merchant purchasing

Channel3's public developer material describes checkout as coming soon/early access. Its documented product search and detail APIs are discovery APIs, not permission to create merchant orders. This implementation therefore exposes an unsupported Channel3 checkout provider with precise blockers. No invented order endpoint, merchant browser automation, or unrestricted retailer payment routing is included. Source: [Channel3 developers](https://trychannel3.com/developers/).

Required before activating purchasing: an official checkout/order API contract, merchant participation and purchasing authorization, credentials scoped to the appropriate sandbox, selected variant/quantity guarantees, shipping/tax quotes, reservation or price-expiry semantics, idempotent order creation, status lookup, cancellation/refund rules, and documented recovery from ambiguous timeouts. Independent merchant integrations must satisfy the same contract. Catalog coverage alone does not satisfy these requirements.

## Stripe arrangement

Stripe Connect direct charges can collect an application fee while a participating connected merchant receives a payment. That is a candidate for a single-merchant checkout, subject to merchant onboarding, capabilities and agreement. Separate charges/transfers support multiple recipients but create the charge on the platform and require a different responsibility model. Neither arrangement allows AnoX to send arbitrary retailers order funds without their participation. The business must approve the seller/payment responsibilities and multi-merchant arrangement before implementation can select a live charge type. [Stripe charge types](https://docs.stripe.com/connect/charges).

A $150 charge is $150 of payment volume; it is not a $5 transaction merely because AnoX's contractual service fee is $5. The proposed fee ledger must distinguish order principal, external charges, conditional AnoX fee, payment-processing expense, refunds and revenue recognition. The foundation uses exactly 500 USD cents as the conditional fee and does not collect it for blocked attempts. No connected accounts, charges, transfers, Stripe checkout sessions or payment configuration were created by this work.

The connected tooling exposed an ANOX LLC sandbox in its account inventory. Inventory is not evidence of merchant onboarding, payment readiness or a successful sandbox payment. No account-specific financial test was run. A sandbox integration test must wait for an authorized, supported purchasing path and the user's account selection/permission.

## Payment confirmation and retries

Browser redirects, local storage and client status flags are not proof of payment. Future providers must bind a signed server notification to a pre-existing owned attempt and payment reference, validate expected amount/currency/environment/account, and perform monotonic, idempotent state updates. Verify the signature over the original raw request body and apply replay-age checks. [Stripe webhooks](https://docs.stripe.com/webhooks).

Stable operation keys must be reused across an ambiguous retry; a changed request with the same key must fail. Stripe's own idempotency mechanism is an additional layer, not a substitute for durable AnoX attempt/order state. [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests).

## Delivered cost and fulfillment

No authorized carrier rate account, package measurements, U.S. receiving address/tax determination, Algeria import classification, duties/tax commitment or FX quote has been established for these new routes. Consequently, unknown amounts remain null, verified payable and guaranteed delivered totals are unavailable, and checkout stays disabled. Carrier integration requires actual source/destination addresses, parcel inputs, service coverage, rate expiry and responsibility for arrival charges. An estimated display cannot silently stand in for a verified amount.

Cancellation, refunds and shipment tracking may only advertise actions supported by the actual merchant/payment/carrier integration. Unsupported actions return explicit capability errors rather than locally marking an order canceled, refunded, paid or delivered.

## Attribution and freshness

Fresh Channel3 offers can contain tracked merchant URLs and commission information. Preserve available attribution as provider metadata; do not recognize commission revenue unless a reporting provider confirms it. A future embedded checkout needs explicit confirmation that its purchase path retains affiliate attribution.

The provider recommends stable IDs for persistence, short caches for presentational fields, and fresh prices/availability/offers on product display. New detail/quote handling follows the fresh-volatile-data boundary; persistent presentation fallback cannot show a cached offer or claim current stock. [Channel3 caching guidance](https://docs.trychannel3.com/guides/caching).

The retained Phase 1 search/discovery cache returns short-lived browsing snapshots (five/ten minutes). The current guidance does not explicitly exempt these cached search prices. That policy needs confirmation from Channel3 before claiming complete provider-term compliance; a cache TTL alone is not proof of contractual permission. Avoiding uncontrolled per-card refresh fanout remains an explicit cost/performance constraint.
