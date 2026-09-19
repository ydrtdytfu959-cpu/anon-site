AnoX Shipping Core — Design Specification

Date: 2026-09-18
Status: Design ready for review; implementation pending
Scope: Shipping sandbox / fulfillment after payment

1. Goal

Build a provider-neutral shipping subsystem for AnoX that starts with an EasyPost test-mode adapter, while keeping Orders, Accounts, Payments, and the customer tracking experience independent of EasyPost.

The first production-shaped flow is:

Paid Order -> Fulfillment -> Parcel measurement -> Rate collection -> Policy scoring -> Selected service -> Test label -> Tracking events -> Customer tracking

No real postage purchase, live carrier charge, or live shipping is permitted in this phase.

2. Decisions already made

Provider-neutral AnoX Shipping Core.

EasyPost is the first carrier aggregator adapter.

EasyPost test/sandbox mode only.

Shipping begins after payment, not before checkout.

Service selection is automatic through a policy engine.

Selection is score-based rather than using a hard maximum delivery-day cutoff.

Parcel dimensions and final packed weight are fulfillment-time facts. The system must use measured package data rather than infer final dimensions from catalog items.

Existing DynamoDB tables AnoX-Shipments and AnoX-TrackingEvents remain the system of record for shipment state and tracking history.

3. Architectural boundaries

Shipping Core

Owns:

shipment lifecycle

parcel validation

provider adapter interface

normalized rate model

policy scoring

selected rate

label metadata

tracking normalization

shipping idempotency and state transitions

Does not own:

authentication

payment confirmation

product pricing

customer account identity

carrier-specific UI

Provider Adapter

Contract:

createShipmentQuote(input)

purchaseLabel(input)

normalizeTrackingEvent(input)

verifyWebhook(input)

The rest of AnoX must never depend on EasyPost response shapes or carrier-specific identifiers except through provider metadata stored as opaque references.

EasyPost Adapter

Phase 1 responsibilities:

use only a test API credential stored in AWS Secrets Manager

create test-mode shipment/rate data

purchase only test labels

map EasyPost objects into AnoX normalized models

reject any response that indicates live mode

4. Security model

Privileged fulfillment actions must not be available through the existing customer JWT routes.

Phase 1 uses an internal Shipping Core Lambda with no public mutation route. Sandbox operations are invoked directly by trusted backend/AWS operations during implementation tests.

Customer access remains read-only through the existing protected routes:

GET /shipments?orderId=...

GET /tracking?shipmentId=...

A later admin/ops UI may expose mutation routes behind a dedicated ops authorization model.

Secrets:

EasyPost test credential lives in Secrets Manager.

No provider API key is stored in source code, Lambda environment plaintext, browser code, DynamoDB, or logs.

Lambda IAM grants secretsmanager:GetSecretValue only for the EasyPost test secret.

5. Data model

AnoX-Shipments

Existing key:

PK: shipmentId

GSI: OrderIdIndex(orderId)

Normalized fields for phase 1:

shipmentId

orderId

userId

provider = easypost

providerShipmentId

providerTrackerId

carrier

service

trackingNumber

status

mode = sandbox

parcelWeightOz

parcelLengthIn

parcelWidthIn

parcelHeightIn

rateCurrency

rateAmountCents

estimatedDays

selectedRateId

policyVersion

policyScore

ratesSnapshot (bounded JSON snapshot)

labelUrl or provider-safe label reference when test label exists

createdAt

updatedAt

labelCreatedAt

State progression:

FULFILLMENT_READY

QUOTING

RATES_READY

RATE_SELECTED

LABEL_CREATED

IN_TRANSIT

DELIVERED

terminal/error states: CANCELLED, EXCEPTION, FAILED

AnoX-TrackingEvents

Existing key:

PK: shipmentId

SK: eventAt

Fields:

shipmentId

eventAt

status

location

message

providerEventId

source

createdAt

Duplicate provider webhook events must not create duplicate logical tracking events.

6. Fulfillment eligibility

A shipment may be created only when:

Order exists.

Order has paymentStatus = paid.

Order status is compatible with fulfillment.

The order is linked to a user when the checkout was authenticated.

No conflicting active shipment exists for the same fulfillment unit.

Phase 1 assumes one shipment per order. Multi-parcel / split fulfillment is explicitly deferred.

7. Parcel handling

The final package is measured after products arrive at AnoX and are packed.

Required fields:

weight

length

width

height

Validation rules:

all values finite and positive

sensible upper bounds to reject entry mistakes

unit normalization occurs inside Shipping Core

stored canonical units for phase 1 are ounces and inches

Catalog weights may be used only as a warning or estimate; they cannot replace final packed measurement for label creation.

8. Normalized rate model

Every provider rate becomes:

{
  "rateId": "...",
  "carrier": "USPS",
  "service": "...",
  "amountCents": 1234,
  "currency": "usd",
  "estimatedDays": 10,
  "deliveryDate": null,
  "deliveryDateGuaranteed": false,
  "provider": "easypost"
}

Invalid rates are excluded when:

amount is missing/non-positive

currency is unsupported

carrier/service is missing

provider identifies a failed/unavailable service

Rates without an ETA may remain eligible but receive a scoring penalty.

9. Policy Engine

Policy version: anox.shipping-policy/1

The engine scores normalized rates; it never chooses directly from provider-specific objects.

Initial factors:

price score: lower is better

ETA score: faster is better, with diminishing returns

missing-ETA penalty

reliability/guarantee bonus when available

USPS tie preference only when total scores are effectively equal

The policy must store:

policy version

component scores

final score

reason for selection

This makes later tuning auditable without changing historical decisions.

The engine must not use a hard 7/14/21-day cutoff.

10. Idempotency and integrity

Idempotency boundaries:

creating a shipment for the same order/parcel request

requesting rates

purchasing a label

processing provider webhooks

Rules:

label purchase must be conditional on the shipment being in RATE_SELECTED.

a second request after LABEL_CREATED returns the existing label record instead of purchasing again.

provider shipment/tracker IDs are immutable after they are committed unless an explicit replacement workflow is introduced later.

shipment writes and relevant order status updates use conditional DynamoDB expressions or transactions where needed.

11. Tracking flow

Provider webhook -> EasyPost Adapter -> normalized tracking event -> TrackingEvents table -> Shipment status update

Requirements:

verify webhook authenticity according to provider-supported mechanism.

reject malformed/untrusted payloads.

deduplicate events.

normalize provider statuses into AnoX statuses.

preserve provider event reference for audit.

never let a stale/out-of-order event move a shipment backward from a terminal state such as DELIVERED.

Customer reads through existing account API routes.

12. Error handling

Provider/network failures:

do not destroy previous successful state

store safe error category, not secrets or raw authorization material

retries must be idempotent

distinguish validation errors from provider downtime

Examples:

invalid parcel -> 4xx-equivalent domain error

no eligible rates -> NO_ELIGIBLE_RATES

provider timeout -> retryable

label purchase failure -> shipment remains RATE_SELECTED

webhook signature failure -> reject without mutation

13. AWS implementation

Phase 1 resources:

AnoX-Shipping-Core Lambda

least-privilege execution role

CloudWatch log group, 30-day retention

EasyPost test secret in Secrets Manager

existing AnoX-Orders, AnoX-Shipments, AnoX-TrackingEvents

no public mutation API in phase 1

Shipping Core IAM:

read Orders

read/write Shipments

put/update TrackingEvents as required

read only the EasyPost test secret

CloudWatch logging

Existing customer Account API stays responsible for ownership-checked reads.

14. Testing strategy

Before calling the external provider:

unit-test parcel validation

unit-test rate normalization

unit-test deterministic policy scoring

unit-test state transition guards

test duplicate label-purchase attempt

test duplicate/out-of-order tracking event handling

Sandbox integration:

create one paid-order fulfillment fixture

create shipment/rates in EasyPost test mode

verify selected rate and stored policy reason

create test label

verify one Shipment record

inject/receive test tracking lifecycle where provider sandbox supports it

verify customer /shipments and /tracking output

No claim of completion until fresh end-to-end evidence exists.

15. Deferred work

Not in phase 1:

live EasyPost credentials

real postage purchase

pre-checkout customer carrier selection

live shipping charge calculation in Stripe

split shipments / multiple parcels per order

returns

insurance purchase automation

customs-document automation

admin UI

provider failover to Shippo

carrier direct integrations

16. Success criteria

Shipping Sandbox phase 1 is complete only when a paid AnoX sandbox order can:

accept measured parcel dimensions/weight,

obtain provider test rates,

normalize and score them,

select one deterministically,

create exactly one test label,

persist shipment/provider references,

persist normalized tracking events,

expose shipment/tracking to the owning customer through existing protected reads,

prove retries do not duplicate labels or tracking records,

perform all provider work without exposing the API credential.
