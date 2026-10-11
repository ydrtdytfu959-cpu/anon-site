# Deployment and rollback boundary

This change is staged for review. It has **not** deployed infrastructure, activated payments, changed live payment configuration, created merchant orders, or merged a branch. Obtain the user's explicit deployment approval after reviewing the final commit, generated templates, test report and this runbook.

## Prerequisites

1. Confirm the intended AWS account (`427064007352`) and region (`us-east-2`) with the operator. Re-read the current `AnoX-Channel3-Catalog` stack, API `zmumi2wruk`, Cognito authorizer, CORS and routes before deployment. The October 11 read-only check confirmed the account, API CORS, existing JWT authorizer and legacy order-table schema; it did not audit all policies or routes. See `aws-metadata.json` for the exact nonsecret fields and successful API calls.
2. Confirm the existing Cognito issuer, audience/client and authorizer ID. New customer routes must use the existing valid JWT authority and the Lambda's matching issuer/client validation; do not substitute a placeholder or create an unauthenticated route to bypass missing configuration.
3. Use a private, approved deployment-artifact bucket if a generated template exceeds CloudFormation's 51,200-byte inline `TemplateBody` limit. The maximum uploaded template is 1 MiB. Do not minify or omit source to disguise a size problem. Uploading an artifact and executing a change set are deployment actions requiring approval.
4. Keep Channel3 credentials in the existing Secrets Manager secret. Do not copy secret values into a template, parameter, environment variable, command line, browser, log or review archive. The commerce service calls the catalog Lambda privately for fresh products and must not gain direct Channel3 secret access.
5. Review the current provider rate plan and the configurable local search/detail/rate budgets. An alarm without a subscribed destination is visible in CloudWatch but does not notify a person; configure an approved operational destination before relying on notifications.
6. Ensure the same-origin frontend is served from `https://anox.app`. Local fixture browser tests intercept requests; they are not proof that the new live routes or CORS work.

## Staged rollout order

- Check out the reviewed commit in a clean workspace. Run the documented generation checks, Node tests, browser tests, and CloudFormation lint/guard validation. Inspect generated source/template parity and CSP.
- Save the current catalog stack template and deployed frontend artifact for rollback. Preserve persistent tables and existing APIs. Create and review CloudFormation change sets before execution; reject unexpected replacements, deletions, broader IAM resources or changes to legacy payment/order/shipping routes.
- Apply the catalog backend extension first, including only its new detail route, scoped invocation permission and usage controls. Confirm search cursor/cache behavior still works and the new public detail route refreshes live offer data. Test invalid IDs/options and missing products without customer or financial operations.
- Apply the separate commerce stack and bind only its namespaced routes. Preserve existing `/orders`, checkout/payment and shipping endpoints. Update the shared API CORS allow-header list to add `idempotency-key` while retaining the exact existing origin restriction and other required headers/methods. This is a separate reviewed change if the shared API is not owned by the new stack; do not import or replace that API implicitly.
- Verify unauthenticated private requests are rejected, a valid customer can obtain only their own quote/attempt/order data, retries replay safely, and wrong-owner IDs return no private data. Use an explicitly authorized test account; do not fabricate Cognito claims against production.
- Deploy the exact complete `index.html` exported from the reviewed commit only after these backend checks pass. The shipped HTML embeds all client JavaScript and its corresponding CSP hash, but it still requires the documented AWS services for live product/quote/order data.
- Confirm desktop/mobile product direct links, lazy catalog browsing, variant mismatches, cart persistence, quote expiry and explicit unavailable-checkout messages against the staged endpoints. Verify the measured upstream counters and alarm configuration.

Merchant ordering and financial collection remain disabled after this rollout. Enabling them requires a separately reviewed supported provider implementation, commercial approval, sandbox end-to-end tests and explicit authorization. No configuration flag in this foundation is evidence of readiness.

## Rollback

- Restore the previously saved frontend first if its new backend dependencies are failing. The prior Phase 1 HTML is preserved on commit `b0ac4df603e300103fd1f2df4aa4d8fe22f4ea07`; use the actual pre-deployment artifact if production has advanced since then.
- Restore the prior catalog template through a reviewed CloudFormation change set, preserving the cache table and existing search function identity. New cache/budget/presentation records are disposable and expire; do not destroy the table or existing product data as a rollback shortcut.
- Disable/remove only the new commerce routes/integration if necessary. Retain the commerce table and audit data. Do not delete or rewrite customer/order/payment state, or apply a schema-destructive migration. Any future genuine financial records require reconciliation before rollback of processing code.
- Restore the exact prior CORS allow-header list only after the new frontend is rolled back and no approved consumer still needs the added header. Preserve the original origin restriction throughout.
- Re-run Phase 1 catalog smoke checks, authenticated legacy reads, CSP checks and error monitoring after rollback. Record commit/template identifiers and outcomes. Browser cache or local flags must never be used to reconcile payment state.

## Review artifacts

`scripts/export-review.cjs` exports only a clean committed revision. It produces the full `index.html`, a ZIP containing committed backend/infrastructure/test/deployment sources, a branch/commit manifest and SHA-256 checksums. It refuses dirty working trees and existing output directories. The final report identifies which checks used injected fixtures and which reached deployed services; new production-route and payment-sandbox checks are unavailable until their explicit deployment/integration prerequisites are met.
