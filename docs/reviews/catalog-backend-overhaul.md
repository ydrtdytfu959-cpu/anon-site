# Catalog backend root-cause review

Date: 2026-10-16. Baseline: `c6c58956ebc28f61f32509f0848f115907d31a7a`.

This report covers the local Channel3 backend and the inactive, authorization-gated CJ TJ Maxx adapter. It does **not** claim complete production catalog restoration. This subtask made no provider requests, obtained no credentials, changed no deployed configuration, and consumed no provider credits. Production coverage and current AWS allocation must be reported from the separate authorized runtime audit.

## Verified defects and implemented repairs

| Severity | Root cause | Repair and regression evidence |
| --- | --- | --- |
| P1 | Search normalization used only the first image and chose `cleaned_url` before validating its host. An unsafe cleaned URL masked a valid regular URL; a bad first image masked the rest of the gallery. | Select a safe CDN image from the bounded gallery, preferring the main image and validating cleaned/regular candidates separately. Keep genuine products without images and report a warning. |
| P1 | Search pages forwarded malformed, unverified, wrong-retailer, and duplicate records without explaining the losses subsequently imposed by the storefront. A successful HTTP status could conceal unusable coverage. | Return only valid merchant-verified cards matching the requested retailer, with reconciled received/accepted/rejected counts, bounded rejection reasons, and counts for all six retailers. Brand labels do not establish or invalidate merchant identity. |
| P1 | Six stored seller-domain slots were mistaken for six retailers. `www` and TJ Maxx aliases could consume those slots before another approved retailer appeared. | Preserve all fourteen exact approved host aliases, still deduplicating hosts and independently counting the six merchants. Regression proves an e.l.f. request remains valid after twelve preceding official aliases. |
| P1 | Pagination lacked product-ID history and remembered only the immediately preceding cursor. Overlapping pages repeated cards; nonadjacent cursor cycles could continue through cached pages. | Carry bounded accepted-ID and cursor-hash history in server-side cursors. Suppress repeated IDs; terminate repeated cursors while preserving valid products from the final page. Cursor bytes remain unchanged on the provider wire. |
| P1 | An empty provider page with a non-null continuation was rejected as an invalid response, preventing access to later available products. | Accept valid empty-page continuations. Each empty page consumes one traversal slot so an empty chain is still bounded. |
| P1 | The existing 500-record cap was applied to accepted cards after filtering, rather than to the remaining source positions. | Apply the bound before normalization. The final 24-record regression with twenty positions remaining reports ten invalid records, ten accepted records, and four traversal-limit rejections. |
| P1 | Expired search pages became unavailable immediately when a budget/rate/provider refresh failed, despite containing only safe presentation data. | Keep fresh TTLs at five minutes for search and ten minutes for discovery. Retain sanitized pages for one hour and explicitly return presentation-only fallback when a refresh fails. No stale continuation, price, availability, variant snapshot, or purchase URL is returned. |
| P2 | The CJ adapter trimmed and truncated product IDs before validation, silently changing source identity and potentially conflating distinct records. It also returned only an aggregate rejection count. | Validate the exact ID before normalization; report malformed record, advertiser identity, product identity, merchant destination, and duplicate rejection counts. Missing approved imagery is a warning. Authorization gating remains unchanged. |

## Source-to-storefront contract

1. `/catalog/search` validates the query and permits exactly one approved `filters.website_ids` domain. The six accepted values are `nike.com`, `adidas.com`, `sephora.com`, `levi.com`, `tjmaxx.tjx.com`, and `elfcosmetics.com`.
2. The provider receives that filter unchanged. The existing budget reservation runs before provider HTTP. Failed requests retain their reservation and are not automatically retried.
3. Official merchant evidence requires an exact approved `offer.domain` and an HTTPS `buy.trychannel3.com` redirect with no credentials or nonstandard port. Untrusted source `sellerDomains` cannot manufacture this evidence. Cached `sellerDomains` are accepted only from a validated internal cache row.
4. Search cards persist presentation data and seller identity, never offers, stock, prices, or purchase URLs. Requested-retailer matching is verified again after normalization.
5. Version 3 cache and cursor identities prevent older rows from bypassing the new verification and diagnostics. Budget keys remain period-only; the version change cannot replenish spending counters.
6. Cursors remain context-bound and expire after thirty minutes. Raw traversal is bounded at 500 slots, including rejected records and empty-page slots. No server-side background pagination was introduced.
7. Product details retain the existing fresh-at-load contract, option checks, full bounded gallery, and separate one-hour presentation fallback. Changes to the approved host bound also prevent alias crowding in detail fallback provenance.

Each Channel3 response adds `data.diagnostics`:

```json
{
  "received": 10,
  "accepted": 6,
  "rejected": 4,
  "rejectionReasons": {
    "invalid_product": 1,
    "unverified_merchant": 2,
    "retailer_mismatch": 0,
    "duplicate_product": 1,
    "traversal_limit": 0
  },
  "retailers": {
    "Nike": 1,
    "Adidas": 1,
    "Sephora": 1,
    "Levi's": 1,
    "TJ Maxx": 1,
    "e.l.f. Cosmetics": 1
  },
  "warnings": { "missing_image": 0 },
  "pagination": { "stopReason": null }
}
```

These are the literal **simulated regression fixture** counts, not production coverage. `accepted + rejected = received`; rejection reasons sum to `rejected`. A product with multiple proven official sellers contributes once to accepted records and once to each of those retailers, so retailer counts are independent and must not be summed as unique products. Pagination stop reason is `null`, `cursor_cycle`, or `traversal_limit`.

Fallback responses retain the original `fetchedAt`, use `expiresAt = fetchedAt + 3600000`, set `status: "presentation_only"`, set `error: "CATALOG_REFRESH_UNAVAILABLE"`, and remove continuation. They expire at the exact original one-hour boundary. Empty or corrupt rows never turn a failed refresh into a successful empty store. The fallback uses an already-validated row; it adds no extra Dynamo read or provider retry. Dynamo TTL retention is distinct from freshness through `retentionExpiresAtMs`. The `catalog_presentation_fallback` metric identifies this recovery path without logging source data or secrets.

## Official provider documentation checked

- [Website filtering](https://docs.trychannel3.com/guides/website-filters) explicitly accepts domains directly in `filters.website_ids`. The already-merged backend filter was valid; no speculative website-ID lookup or additional provider request was needed.
- [Offer semantics](https://docs.trychannel3.com/guides/offer) distinguish the merchant from the product brand. Filters apply to an individual matching offer, while the returned product can still contain other offers. This supports independent post-response merchant verification.
- [Image guidance](https://docs.trychannel3.com/guides/images) describes main images and cleaned URLs on the same image record, supporting safe fallback rather than first-image-only selection.
- [Caching guidance](https://docs.trychannel3.com/guides/caching) permits brief presentation caches and requires refreshing volatile price, availability, and offer links before showing them. This repair does not extend presentation beyond one hour or cache volatile commerce values in search.
- [Locale guidance](https://docs.trychannel3.com/guides/locale) documents default `en` / `US` / `USD`, matching the existing search behavior; detail explicitly requests that locale.

The offer guide contains a `www.buy.trychannel3.com` example, whereas this application accepts `buy.trychannel3.com`. No host expansion was made solely from that example. A real returned host mismatch should be verified before changing both backend and client link policies.

## Coverage and external limitations

All six retailers pass independent, synthetic merchant verification tests, including source-scoped searches, missing-brand products, missing images, host spoofing, and cross-page duplicates. Actual product counts, diversity, available details, and account-specific provider coverage were **not measured in this subtask**. A successful fixture or API response is not proof that any retailer has adequate production inventory.

The CJ TJ Maxx adapter remains inactive unless explicit verified display authorization is supplied. A search-capable integration alone is not accepted as retailer-feed authorization. This work does not activate a route, retrieve credentials, perform purchases, or create new infrastructure.

The owner reported a newer monthly free-search ceiling of 500 with daily 60, monthly detail 200, and paid usage disabled. This subtask did not independently verify or modify those settings. The older 60-monthly assumption must not overwrite the separate runtime audit or owner-approved configuration.

## Verification

New tests were executed against the original implementation before each repair: the first six catalog regressions failed, the four fallback/security regressions failed, both CJ identity/diagnostic regressions failed, and the official-alias regression failed. Each subsequently passed after implementation.

Final focused command at handoff:

```sh
node --test tests/backend-catalog.cjs tests/backend-cache.cjs tests/backend-detail.cjs tests/backend-runtime.cjs tests/backend-budget.cjs tests/cj-official.cjs
```

Result: **92 tests passed, zero failed**, Node.js v24.18.0. All provider HTTP and Dynamo interactions in these tests are simulated at the external boundary; actual request validation, normalization, cache, cursor, budget, and response code executes.

A full `npm test` snapshot during concurrent integration had **330 tests, 318 passed, 12 failed**. The failures were outside the focused backend set: two `adapter-cursor` policy/legacy fallback tests; authenticated request transport in `auth-commerce`; canonical bundle/CSP checks in `bundle.test` and `client-bundle`; transport and mixed diagnostics in `catalog-overhaul`; commission attribution and account change in `commerce-client`; the generated commerce template; the review export's generated-template check; and the staging route count. The integrator owns template regeneration and the final full-suite run. These snapshot failures must not be represented as a passing release suite.

## Files and release considerations

Changed: `backend/index.js`, `backend/cj-official/index.js`, `tests/backend-catalog.cjs`, `tests/backend-cache.cjs`, and `tests/cj-official.cjs`.

No generated templates were edited in this subtask. Regenerate canonical templates from the final source before release. Version 3 intentionally starts a new cache/cursor namespace; expect initially cold caches and expired pre-release cursors. The frontend must present cursor restart and presentation-only warnings, and must accept the additive diagnostics and explicitly flagged one-hour fallback. A code rollback does not reset budget counters. Production deployment remains subject to explicit owner approval.
