# Legacy payment isolation and recovery proposal

**NOT APPROVED FOR EXECUTION.** This proposal changes no AWS resource, payment configuration, session or historical record. It carries forward REL-04, LEG-01 and LEG-02. The new commerce frontend already rejects legacy financial routes; the public legacy sandbox route remains a separate production exposure until its owner approves isolation.

## Evidence and conflicts

The previous read-only audit recovered processed CloudFormation inline source for `AnoX-Checkout-Core`, `AnoX-Checkout-Auth`, `AnoX-Payment-Webhook`, `AnoX-Payment-Read-API`, `AnoX-Account-API` and `AnoX-Shipping-Core`. See [security findings](../remediation/security-findings.md) and [template inventory](../remediation/legacy-template-inventory.json). A fresh [processed-source hash comparison](aws-legacy-source-hashes.json) found no substantive change in the four checkout/payment sources; the prior temporary exports had one appended newline. This establishes template behavior, **not deployed ZIP equivalence**. No payment or merchant purchase was attempted to test it.

| Surface | Observed behavior | Consequence / required disposition |
| --- | --- | --- |
| Public `POST /checkout` | Synthetic `p01`–`p28` catalog, 750 basis-point service fee, base shipping 1,050 cents plus 800 cents/kg of modeled weight; only `sk_test_` keys admitted. | Not the approved merchant model or conditional 500-cent order fee. Sandbox enforcement reduces live-money exposure but does not make amounts or purchasing truthful. Block reuse and propose disabling new session creation. |
| `POST /checkout-auth` | Cognito authorizer; wrapper invokes core before conditionally linking ownership. | Core success followed by link failure can orphan a sandbox session/order. Authentication does not repair transactional/idempotency weaknesses. |
| Retry/session creation | UUID created for each incoming request; Stripe idempotency uses that new order ID. | Retrying a customer request can create another session. External session creation followed by failed database work has an ambiguous side effect. Do not retrofit by deleting failed records or retrying purchases. |
| `POST /webhook` | Raw-body HMAC, constant-time comparison, five-minute replay boundary; test-mode event handling; amount/currency/session binding and atomic event/order/payment writes. | Preserve this drain/reconciliation route while outstanding sandbox sessions exist. Successful payment state is not proof of a merchant order. Refund/dispute coverage is incomplete for future live commerce. |
| `GET /payments`, owned account/orders | JWT subject and order ownership checks precede reads. | Preserve historical reads and account linkage during isolation. Do not migrate old synthetic totals into authoritative new quotes or orders. |
| Shipping | Test-mode EasyPost path after a paid legacy order; requires parcel inputs but parses rates through floating-point conversion. | Not a pre-checkout Algeria landed-cost guarantee. No reuse without separate exact-money/provider/parcel validation. |

The new commerce stack has its own retained table and narrowly scoped role; it cannot read legacy orders/payments or create Stripe payments. No browser callback, stored status, public capability flag or fallback activates financial operations. The disconnected new webhook module is **not an exposed endpoint**. This source boundary does not disable the separate deployed legacy endpoints.

## Independently approvable containment

Approval must identify exact function versions, route IDs, integrations, stack revisions, sandbox account/environment and operator. Capture current hashes first; reject drift from the reviewed processed source. The HTTP API `$default` stage is AutoDeploy-enabled, so changing a route or integration is a live change even without a separate deploy command.

1. Inventory callers and owner-approved sandbox sessions without placing sensitive payloads in this repository. Record the maximum session lifetime, outstanding webhook backlog and authoritative session-to-order mapping. Obtain separate permission for customer/payment-data inspection if needed; it is not part of this read-only metadata review.
2. Prepare a reviewed core/wrapper release that rejects **new session creation before any secret read, provider request or database write**, with a stable `checkout_unavailable` 503/409 contract and no amount. Include both public and authenticated entry points plus internal invoke callers. Do not leave an alternate route able to invoke the old version. Keeping the route identity with an honest rejection minimizes client breakage; any alternative route removal needs explicit approval.
3. Continue verified webhook receipt processing and owned historical reads. Do not expire, cancel, refund or recreate sessions as an implicit consequence of disabling creation. Those provider-side actions require separate sandbox/payment authorization and a reconciliation plan.
4. Keep legacy and commerce resource identities separate. New merchant/payment records require the activation contract in [checkout-activation-spec.md](checkout-activation-spec.md); do not import a legacy `PAYMENT_CONFIRMED` state as merchant acceptance or recognize its fee as the approved AnoX fee.
5. Validate with an isolated fixture first, then with specifically authorized sandbox tests: creation endpoints reject before side effects, duplicate webhook receipts remain harmless, amounts/session/account are verified, and historical owned reads continue. No live charge or merchant order is an acceptance test.
6. Observe the drain period. Archive only according to an approved retention policy after provider reconciliation. Retain immutable event/idempotency/audit identities. Do not delete historical order/payment data or remove webhook authenticity checks.

## Rollback and incident controls

Preserve the captured previous function versions, processed templates and API bindings, but do **not** automatically re-enable the incompatible charging path when a deployment fails. If the rejection response breaks a caller, fix the caller or roll back to a compatible fail-closed artifact. Re-enabling session creation requires a new explicit decision acknowledging its business and retry defects.

Rollback must preserve receipt processing, ownership and retained data. Never reset an idempotency ledger, overwrite a newer function, import synthetic legacy totals, change webhook secrets or switch sandbox/live modes to repair an outage. If an ambiguous sandbox operation exists, reconcile by its original provider identity before any authorized action; a local failure is not evidence that the external operation failed.

## Acceptance and ownership

REL-04/LEG-01 remain **BLOCKED — APPROVAL REQUIRED** for production isolation and for any legacy financial reuse. Engineering can prepare the change only against captured current deployed source; the current user instruction explicitly withholds live payment changes. ANOX must name the payment-operations owner and approve containment, provider-data reconciliation, retention and the test scope. No fee collection becomes authorized by approving this isolation proposal.
