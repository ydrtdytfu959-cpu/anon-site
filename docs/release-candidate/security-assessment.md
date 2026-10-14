# Security and financial trust boundaries

This delta review continues [the original security findings](../remediation/security-findings.md); it does not relabel historical source inspection or fixture execution as new cloud verification. The final commit and test evidence are pinned by the export manifest and [validation](validation.md).

## Authority and ownership

API Gateway's Cognito JWT authorizer must perform signature/issuer/audience/time validation on every private route. The Lambda additionally validates the trusted Gateway claim shape, configured issuer/client, subject, token type and expiration before selecting a hashed owner partition. That second check is **not an independent cryptographic JWT verifier**. IAM invocation and route-authorizer binding are therefore part of the boundary; a principal allowed to invoke the Lambda directly must be treated as privileged. Real Gateway rejection with two Cognito-issued test identities is still a staging gate.

`backend/commerce/index.js`, `validation.js` and `store.js` enforce owner-scoped reads and mutations. Quotes, blocked attempts and order records do not accept a customer identity from the body. Foreign and missing orders/quotes use indistinguishable rejection paths. Public capabilities disclose no customer data. Browser prices and unknown fields are rejected before product hydration; request retries bind a stable idempotency key to the canonical request hash. DynamoDB conditional claims and atomic completion/audit writes prevent duplicate persistence in the tested model. Ambiguous provider/transaction responses remain a real-service acceptance requirement.

Quotes expire at the earliest upstream expiry and no later than 30 seconds from each snapshot and quote creation. DynamoDB TTL is eventual cleanup, never authority. Neither an InStock response nor a quote reserves merchant inventory. Unknown selected stock, ambiguous merchant offers, price changes and unsupported currencies cannot become an authorized purchase. Exact integer USD calculations preserve quantity multiplication and the single conditional 500-cent fee.

## Browser and provider data

`auth.js` now admits only the actual backend contract: 80-character IDs, lowercase 64-hex cart binding, bounded DNS labels, 32,000 UTF-8 request bytes, ten quote lines/five product-option snapshots and no duplicate selection identities. Equivalent options in a different property order and changed quantities cannot evade duplicate detection. Distinct merchant/condition selections remain distinct. These are admission/UX controls; the backend remains authoritative even if a caller bypasses JavaScript.

Catalog search data is untrusted. `backend/index.js` schema-2 sanitization removes volatile offers/prices/stock/variants from cached cards. `catalog-live.js` strips them even from an older deployed payload; only explicit Channel3 presentation records may contain null price/empty variants. No null-to-zero card rendering or fabricated available variant is permitted. Product detail uses a separate fixed provider endpoint and strict response/schema/expiry checks. Cursor associations are query/filter/section/limit/schema-bound; unknown or expired tokens reject without resetting to page one or spending another first-page credit.

Existing escaped rendering, URL validation, image count/pixel budgets, CSP source restrictions and request abort/stale-generation handling remain. Browser test transports reject unexpected external requests. Canonical modules are embedded only through the official build, which regenerates the script hash and checks full inline syntax. No credential is added to browser code, client URLs or cached responses. Public CORS is restricted to `https://anox.app`; it is not a substitute for server authorization or anonymous abuse controls.

## Spending and infrastructure

New catalog budgets default to zero and require reconciled explicit allocation. Atomic counters/leases use stable identities independent of cache schema. Namespace validation prevents staging usage from polluting production EMF and fails closed for unrecognized configuration. Staging gets separate API, Cognito, tables, functions, credential reference and namespaces. No production credential value or data is copied.

The actual AWS role inventory still shows a direct Channel3-secret grant to the legacy Catalog-API and an indirect Chat/Smart-Catalog path. Thus runtime counters are not an account-wide financial boundary. The narrow [consumer isolation proposal](channel3-consumer-isolation.md) needs approval and old-worker draining. No IAM change has been applied. Cache counter restoration cannot recreate allowance: dispatch must stop, consumed/in-flight usage must be reconciled, and unknown usage requires zero new allocation.

The new commerce role has no payment/merchant secret or legacy order-table access. Staged tables retain encryption, PITR, deletion protection and retention policies; existing resources differ as recorded in [fresh table evidence](aws-tables.json). No destructive resource change, data deletion, quota request, S3 upload or change set was performed. Exact deployment principal permissions, organization/resource policies and actual ZIP/frontend provenance remain pre-deployment checks; this review does not claim universal effective-IAM proof.

## Financial isolation and recovery

The exposed new handler has no payment creation or webhook route. CheckoutProvider capabilities remain unsupported; attempts remain blocked and never create an order/payment. The disconnected webhook module's signature/binding/CAS tests are foundation evidence only. Complete pending/failed refund, dispute, transfer/application-fee reversal and financial retention/reconciliation behavior is specified in [checkout activation](checkout-activation-spec.md), not implemented or activated.

Legacy payment infrastructure remains a separate surface: synthetic catalog, 7.5% fee, modeled shipping and insufficient incoming retry identity are incompatible with the approved business model. Sandbox-key checks do not fix those semantics. The new frontend has no legacy fallback, but only separately approved containment can close the deployed public route. Preserve authenticated historical reads and verified receipt processing during any future isolation; do not rewrite old states as new merchant acceptance. See [legacy isolation and rollback](legacy-isolation-proposal.md).

Delivery validation is server-internal and disabled by default. Immutable address/contents/service references must eventually resolve through an ownership-checked approved adapter; syntactically valid references or five-digit postcodes do not prove an address, carrier lane or actual measurement. Evidence binds exact cart/parcels/service/provider, rejects stale/unsafe/unknown money, and cannot produce a final payable total. No PII collection or carrier API operation was added.

## Independent review and remaining assurance

Root reviewed new delivery and staging contracts; a separate workstream reviewed catalog sanitization, nullable presentation records, cache/counter identities, metric namespaces, the cost model and client admission. Demonstrated mismatches received regression coverage: duplicate quote admission, staged Cognito password-flow support and schema-rejection status. The service-binding delivery regression also preceded correction. The final focused and whole-system results are recorded in validation; earlier generated-parity failures remain documented and must be resolved by the final canonical build.

No demonstrated actionable source-level P0 bypass remained in the reviewed delta at handoff. This is a bounded engineering finding, not a guarantee of absence of vulnerabilities. Open P0/P1 cloud, isolation, quota, commercial, data-retention and real-service gates remain in the [issue register](release-assessment.md). Release B stays blocked regardless of local test results.
