# AnoX commerce foundation implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement these subsystem tasks and verify each dependency before integration.

**Goal:** Deliver truthful product details, persistent customer selections, backend-authoritative cost quotes, and secure order interfaces while unsupported purchasing stays disabled.

**Architecture:** Continue the verified Phase 1 branch. Preserve the single-file deployable frontend with canonical bundled modules, add Channel3 detail hydration to the catalog backend, and isolate new authenticated commerce routes and persistent state from existing production order/payment endpoints. No integration can become operational through a browser flag or configuration switch alone.

**Tech stack:** Node 24, browser JavaScript, AWS Lambda/API Gateway/Cognito/DynamoDB/Secrets Manager, CloudWatch, Node test runner, Playwright.

**Spec:** The user's complete engineering request of October 8 and maximum-quality resume protocol of October 9, 2026; summarized in `docs/commerce/progress.md`. The original supplied documents remain in the chat attachments.

## Global constraints

- No merge, production deployment, live payment configuration change, charge, or merchant order.
- Original merchant remains seller; AnoX service fee is exactly 500 USD cents per successful order.
- Unknown shipping, tax, duties, weight, availability or FX remain unknown; no guaranteed total without established charges.
- Only official Channel3 APIs; public catalog does not imply purchasing authorization.
- Preserve catalog card image budget, existing providers, authentication/CORS/CSP boundaries and user changes outside this worktree.
- Use exact minor-unit arithmetic, bounded untrusted payloads, explicit ownership and idempotency.
- Report mocked, deployed and sandbox evidence separately. No hidden incomplete features presented as operational.

## Review focus

1. Variant relaxation by Channel3 must never silently substitute the customer's selection.
2. Slow responses after navigation, cart edits or account switching must not overwrite current state.
3. Concurrent duplicate quotes, retries and webhook deliveries must not multiply financial operations.
4. Unknown or stale charges must not become zero or an apparently verified delivered price.
5. Browser-local order or payment flags must never establish server payment authority.

## Task 1 — Complete Phase 1 report

- [x] Preserve clean Phase 1 commit `b0ac4df603e300103fd1f2df4aa4d8fe22f4ea07` and draft PR #5.
- [x] Re-run build/check, 82 Node tests, Chromium and Firefox catalog tests, and bounded live AWS pagination/Load More verification.
- [x] Record all changed files, live evidence, existing favicon failure, resources and limits in `docs/commerce/phase1-completion.md`.

## Task 2 — Product detail and catalog cost controls

**Files:** `backend/index.js`, existing backend template/builder/guard, `catalog-live.js`, focused detail/budget tests and provider evidence documentation.

**Interfaces:** New public `GET /catalog/channel3/products/{id}` avoids collision with existing Nike/CJ route. It accepts documented option selections and returns bounded sanitized detail data with freshness and selection mismatch. Private fresh hydration for quotes requires an IAM-only invocation contract; the public endpoint cannot request arbitrary cache bypass.

- [x] Verify official detail/variant/freshness terms; encode response fixtures and invalid selection tests before implementation.
- [x] Implement bounded gallery/descriptions/options/merchant/offer attribution, preserving unknown stock and weights.
- [x] Implement presentation caching, fresh volatile product data, coalescing, fail-closed distributed usage budgets and metrics/alarms.
- [x] Verify existing cursor/cache tests still pass and detail responses survive frontend normalization without invented values.

## Task 3 — Authoritative commerce backend

**Files:** `backend/commerce/`, separate staged commerce CloudFormation, focused money/quote/provider/order/webhook tests.

**Interfaces:** Namespaced `/commerce/capabilities`, `/commerce/quotes`, `/commerce/checkout-attempts`, `/commerce/orders`, `/commerce/webhooks/stripe`. Capabilities public; customer state authenticated by existing Cognito authorizer; webhook has its own signature boundary. Exact wire contract is documented beside implementation and shared with frontend owner before coding consumers.

- [x] Inspect existing auth/payment/order/shipping dependencies and nonsecret config, preserving existing routes/tables.
- [x] Test exact money, client price rejection, owner/cart binding, expiry and duplicates before implementing quotes.
- [x] Implement fresh product validation and explicit known/estimated/unknown cost components. Fee is separate, payable only after supported success.
- [x] Implement durable records, atomic idempotency and audit/state transitions; invalid ownership returns no private data.
- [x] Add CheckoutProvider registry with explicit unsupported providers and no live purchasing implementation where no official integration exists.
- [x] Validate raw-body Stripe signatures, duplicate/reordered events and payment/order binding where applicable; default disabled capabilities cannot collect a fee.
- [x] Stage least-privilege resources, retention, throttles and alarms without deployment.

## Task 4 — Product, cart, quote and order UI

**Files:** `index.html`, canonical `auth.js`, new `commerce-client.js`, focused frontend tests and `scripts/browser-commerce.cjs`.

**Interfaces:** Canonical detail adapter from Task 2; authenticated namespaced commerce contract from Task 3. Existing preview behavior remains separate and cannot create production orders.

- [x] Promote active strict auth module before extending a narrow method/path allowlist; retain refresh and stale-session protections.
- [x] Build direct-link detail hydration, real gallery/options, mismatch handling, and accessible mobile interactions.
- [x] Implement bounded persistent saved-selection cart, quantity/update/remove, metadata retention and concurrent-edit protection independent of purchasability.
- [x] Render server cost components and blockers; invalidate reviewed quotes on cart/customer changes and expiry.
- [x] Render owned orders/tracking and supported actions from server state; browser redirects never confirm payment.
- [x] Run desktop/mobile fixture tests for deep links, incomplete data, slow responses, restoration, edits, unknown costs and disabled checkout.

## Task 5 — Integration, review and delivery

**Files:** source bundle tooling/tests, CI, reports and reproducible release packaging script.

- [x] Enforce deterministic canonical catalog/auth/commerce bundling and exact CSP with drift and syntax tests.
- [x] Run all Node/browser/CloudFormation validations and inspect actual source contracts; document unavailable live/sandbox tests precisely.
- [x] Independent whole-change security and correctness review; fix findings with regression tests.
- [ ] Commit and create draft unmerged PR; verify remote tree and CI.
- [ ] Export exact complete branch `index.html`, changed backend/infrastructure archive, checksums, engineering report and deploy/rollback instructions.
- [ ] Stop for user review; do not deploy or merge.
