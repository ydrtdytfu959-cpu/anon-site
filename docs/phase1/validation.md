# Phase 1 verification

Feature branch: `feat/channel3-catalog-phase1`, from `main` at `9b81ec5c1a791f3aacec4fc3df503bef742c9a84`. The frontend is reviewed through an unmerged PR. No cart, checkout, payment, order, shipping, fee, authentication, or PDP rendering changes are included.

## Pagination and discovery

Verified the official Channel3 contract before implementation: POST `/v1/search` accepts JSON `page_token`, and responds with `next_page_token`. The frontend sends the exact opaque cursor as the AnoX API's `page_token` query parameter; the Lambda forwards it in the upstream JSON body. No numeric offset is invented for Channel3. Nike/CJ retain offset behavior.

Sections load on selection, one at a time: featured, men, women, shoes, clothing, beauty, accessories, sports and brands. Text search uses a separate context. Six recent contexts retain independent cursors and up to 500 deduplicated records each. Retained products remain resolvable for details but cannot leak into another section's search suggestions or filters. Expired/invalid continuations require explicit restart. Failed append/restart requests do not discard previously accepted records or silently begin page one.

Catalog pages retain at most 24 products and one primary image per product, fitting the unchanged 4,000,000 declared-pixel page budget. The strict active inline adapter was promoted into canonical `catalog-live.js`; build/check tools now enforce byte-for-byte bundle parity and the exact inline CSP hash.

Sources: [Channel3 search API](https://docs.trychannel3.com/api-reference/v1/search), [pagination](https://docs.trychannel3.com/sdk/pagination), [caching guidance](https://docs.trychannel3.com/guides/caching).

## Cache and AWS

Applied CloudFormation change set `phase1-catalog-cache-20261008` to existing stack `AnoX-Channel3-Catalog` in account `427064007352`, region `us-east-2`. Result: `UPDATE_COMPLETE`; existing function identity and API integration preserved.

- Created DynamoDB table `AnoX-Channel3-Catalog-CatalogCache-GGLNCMZC7CSK` with on-demand billing, encryption and TTL.
- Created IAM role `AnoX-Channel3-Catalog-Channel3Role-3AzyNIuhdUvo`, scoped to the exact Channel3 secret, cache table and existing log streams.
- Updated the existing `AnoX-Channel3-Catalog` Lambda code, role and cache environment variable.
- Left API Gateway routes/CORS, secret value, shared CJ role, product table, and commerce/auth resources unchanged.

Cache keys hash version, provider, mode, section, NFC-normalized/whitespace-collapsed case-preserving query, canonical supported filters, limit and cursor. Search TTL is five minutes; discovery TTL ten minutes. Search changes more frequently, while repeated discovery traffic benefits from slightly longer reuse. Both are short browsing snapshots rather than price/stock guarantees. Application expiry checks are authoritative; DynamoDB TTL removal is asynchronous. Cursor associations last at most 30 minutes. Local coalescing and conditional distributed leases prevent ordinary identical miss fanout; publication is transactional and owner-checked. Cache failures fail closed, and failed upstream responses are never cached as successful data.

CloudWatch namespace `AnoX/Catalog`, dimension `Service=Channel3Catalog`, exposes `cache_hit`, `cache_miss`, `upstream_request`, `upstream_failure`, `cache_contention`, and `cache_error`. `upstream_request` increments immediately before actual HTTP dispatch, after secret retrieval and cursor-deadline checks. Logs contain no request query, token, body, API key, authorization header, customer data or cache identity. Counts estimate attempted Channel3 requests, not a provider billing reconciliation.

## Checks

- 82 Node test cases passed: adapter/legacy Nike validation, cursor transport, three-page traversal, overlap deduplication, sparse page 22, context resets, coalescing, cancellation, stale responses, retry/restart, TTL, safe normalization, provider state, caching and distributed lease behavior, failure handling, source/template parity, syntax, security boundaries and CSP.
- Chromium and Firefox: eight browser groups per engine passed with the production CSP enabled. Each ran the existing embedded suite: 134/135 checks passed, with only the independently reproduced pre-existing favicon expectation described below.
- CloudFormation `cfn-lint` 1.46.0: passed. CloudFormation Guard 3.2.1 with `backend/catalog.guard`: passed. AWS ValidateTemplate and change-set validation: passed; change set adds only table/role and updates the existing function without replacement.
- Real upstream preflight: one bounded call verified product/offer/image shape against the new sanitizer and adapter.
- Actual deployed endpoint: three cursor pages yielded 69 normalized products with 69 unique identifiers. Identical and whitespace-equivalent requests returned identical cached snapshots. Separate men discovery succeeded; unissued cursor returned 400. Full sanitized results are summarized in `deployed-smoke.json`.
- Actual backend plus final HTML in Chromium: first page rendered 22 products, Load More rendered 46 unique products, native cursor sent, zero runtime errors or CSP violations. This used cached pages from the smoke sequence.
- Structured CloudWatch events for that sequence recorded five misses, five upstream HTTP requests and four cache hits, with no upstream failure. This confirms replays/browser requests reused the server cache.
- Real expired-cache refresh: the search snapshot fetched at `2026-10-08T04:08:50.309Z` was naturally expired before the request at `11:41:54Z`. The API fetched a new snapshot at `11:41:58.814Z`, and its immediate replay was byte-equivalent. Malformed cursor encoding returned 400. Allowed-origin and foreign-origin preflights confirmed the existing CORS restriction. See `deployed-expiry.json`.
- Newly created table verified `ACTIVE`, on-demand, encrypted and TTL `ENABLED` on `expiresAt`. The API's CORS configuration is identical to the pre-change configuration. Upstream-failure, cache-corruption, race and expired-cursor fault cases use deterministic injected transports; no production outage was induced for testing.

## Review and limits

Independent reviews plus a second implementation review corrected: timeout mismatch, cursor expiry during cache/secret work before a paid call, premature 21-page cutoff, lost provider status after local reload, stale retained-context suggestions/filter counts, lost section on brand navigation, source/category validation mismatch, and a browser race test that could pass without an in-flight request. Targeted correction review reported no remaining release-blocking findings.

Known existing limitation: the embedded favicon self-test expects a data URI, while production intentionally references `/favicon.svg?v=3`; reproduced unchanged on the base commit. Its expectation was not rewritten as part of catalog work.

Discovery sections are explicit curated search contexts, not an exhaustive product/brand index. The supported remote filter subset is availability and condition; other existing UI filters remain local. The API remains public as before, with existing CORS; caching is not an account-wide spend cap or anti-abuse service. PDP galleries, direct Channel3 PDP hydration and Channel3 wishlist integration remain outside this phase. Browsing prices/availability are temporary snapshots; no purchase or payment authority is added.
