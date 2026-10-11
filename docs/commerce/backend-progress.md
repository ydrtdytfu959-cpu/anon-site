# Commerce backend recovery checkpoint

Branch `feat/anox-commerce-foundation`, base `b0ac4df603e300103fd1f2df4aa4d8fe22f4ea07`. Updated 2026-10-11. Backend completion owner: `backend_release` (continued `backend_finish` files).

Requirements and plan read; existing work preserved. This worker owns `backend/commerce/`, separate commerce infrastructure and focused backend tests. No deployment, configuration mutation, secret retrieval, order, payment or commit is authorized in this worker task.

## Contract decisions

- API namespace `/commerce`; existing order/payment/shipping routes remain outside this stack.
- Quote response envelope `{schemaVersion:1,quote:{...}}` agreed with frontend. Exact contract is in `backend/commerce/README.md`.
- Fresh quote hydration uses IAM Lambda invocation `{operation:'commerce.product',productId,options}` and the catalog worker's fresh envelope. Strict variant, condition, merchant, price and freshness validation.
- Quotes support at most 10 lines / 5 distinct product-and-option selections, quantities 1–20. Three concurrent fresh reads, nine-second hydration budget; incomplete reads fail without issuing a quote. Limits are public capabilities.
- Atomic owner-bound idempotency prevents repeated concurrent fanout. Unsupported checkout persists a blocked attempt and creates no order or payment.
- Exactly 500 USD cents is a conditional fee per successfully completed order; unknown taxes/shipping/import amounts never become zero or a verified total.
- Ruling: use the existing catalog Lambda for private fresh hydration to preserve credential isolation and its global request budget; synchronous reads are bounded by deadline/concurrency despite the general preference against chained synchronous Lambdas.
- Existing shipping design supports fulfillment after payment; it does not establish precheckout DZ landed rates or parcel measurements. Preserve it.

## Current state (2026-10-11)

Implemented `backend/commerce/{errors,money,validation,providers,quote,orders,index,store,webhooks}.js` plus deterministic test helper and focused money/service/persistence/webhook suites. Initial 28 backend tests plus 14 commerce client tests passed (42/42, zero skipped). Tests are local mocked persistence, not deployed or Stripe sandbox verification. The one early checkout test failure correctly exercised idempotency input conflict; the test now uses a new key for the distinct corrected request.

Cross-component review corrections pass: official variant stock tri-state, option/identifier/Unicode bounds, tracked URL/commission boundary, safe error and order output validation, active payment identity fencing, fulfillment-independent payment CAS and nonexpired lease completion. Root/catalog independent review identified the payment identity/version issues; regression tests failed first and now pass. No deployment or financial operations occurred.

Completed runtime adapter, deterministic bundled CloudFormation, Guard rules, staged API CORS/throttle update-and-rollback helper, and corresponding verification. Focused backend/runtime/infrastructure suite now passes **49/49, zero skipped**. Template parity, runtime/build/helper syntax, `cfn-lint` and `cfn-guard validate` all passed on 2026-10-11. The actual generated bundle boots under injected runtime SDKs; malformed/oversized/failed/missing responses fail without state writes and cancellation does not retry. Commerce template is 67,028 bytes; approved private S3 TemplateURL required for future deployment. No generated client/index files were edited by this worker.

The earlier AWS account-usage interruption was resolved by the resumed read-only root inventory on 2026-10-11. Confirmed account `427064007352`; API `zmumi2wruk` preserves only `https://anox.app` CORS, no credentials, GET/POST/PUT/OPTIONS, content-type/authorization, MaxAge 3600. JWT authorizer `qcopg9` uses issuer `https://cognito-idp.us-east-2.amazonaws.com/us-east-2_gUci3YuMm`, audience `63738r9gpr126qpgp1a5cubchi` and Authorization identity source. Existing `AnoX-Orders` is ACTIVE/on-demand with `orderId` hash key and remains untouched. Explicit issuer/authorizer parameters still require review at deployment. Stage/route inventory and concurrency quota checks, actual new endpoint/IAM/CORS/conditional-write verification, and customer-data retention decisions remain approved-deployment prerequisites, not completed deployment tests. Payment/merchant/fulfillment paths remain unavailable by design.
