# Legacy catalog warmer repair review

## Outcome and scope

Prepared a local replacement for the existing `AnoX-Catalog-API` Lambda that supports the existing schedule's `{"action":"warm"}` input. No production code/configuration, schedule, IAM policy, paid budget, provider credential, table, or infrastructure was changed. The replacement uses CJ only and adds no Channel3 calls or credential access.

The root task's post-update bounded live smoke is separate from this local repair. AWS readback at **2026-10-16 13:24:39 UTC** proved monthly search=66/detail=42, exactly six above the prior 60/36; daily search=6/detail=6/all=12. The AWS audit, including temporal pre- and post-smoke observations, is in [the evidence report](../evidence/aws-audit-2026-10-16.md).

## Root cause and source provenance

The enabled `AnoX-Catalog-Warm-V2` EventBridge rule sends `{"action":"warm"}` every six hours. The actual deployed package supported only HTTP GET list/detail events and returned an HTTP-style 404 object for that scheduled input. Lambda therefore completed successfully without warming any products. This was reproduced locally against the exact deployed source with zero mocked provider calls or cache writes.

The downloaded ZIP contained only a 4,649-byte `index.js`. Its SHA-256 base64 exactly matched Lambda `GetFunction`: `ZpmZQUfS7jzSblQBdSerfzueAl/pFGByHec1IV/P9Uo=`. The exact original source is retained as `backend/legacy-catalog/deployed-index.js`; its SHA-256 is `1ef4ba50216bb43853efeec9b0dced0fdccd69702e851583bc55b60f035ba418`. The build verifies both length and source digest before preparing rollback artifacts.

The actual original source calls only `https://ads.api.cj.com/query` with the configured Nike advertiser. Its existing Channel3 environment reference and IAM grant are unused standing access, not a provider-spending path in that verified version. Removing those unused configuration entries remains a separate owner-approved infrastructure change.

## Implementation

- `index.js` adds an exact warm-event contract and translates it to one fixed Nike list request, offset 0, limit 20. Extra fields cannot override the retailer, query, pagination, route, or source.
- `cj-handler.js` preserves the verified CJ HTTP behavior in readable source. It caps persisted/returned rows to the requested limit even if the provider overreturns. It rejects cache writes left unprocessed after the existing maximum of three batch attempts.
- Official merchant evidence is checked before returning or persisting products: advertiser `4942550`, Nike advertiser name, and an HTTPS official Nike destination. Cached details are revalidated, provider details must match the requested product ID, and Jordan manufacturer-brand rows remain supported.
- List pagination adds `rawCount`, explicit `nextOffset`, and response-only absolute product `sourceIndex` values. Rejected rows cannot cause overlapping offsets, terminate an advancing empty page, or lose a later valid product during partial consumption.
- Credential JSON parser errors are replaced with a fixed error. The outer catch logs only `catalog_request_failed`, and upstream diagnostics contain only numeric status/error counts. Neither arbitrary SDK messages nor credential fragments are logged.
- A provider failure, malformed warm result, empty warm result, or incomplete cache write throws from the scheduled entrypoint. These failures no longer look like successful Lambda executions carrying an ignored HTTP error object.
- Original HTTP list/detail fields and the six-hour detail cache window remain compatible; pagination metadata is additive. This change does not add list reads from DynamoDB, offline catalog browsing, additional retailer authorization, or new product coverage claims.
- `build.cjs` prepares deterministic candidate/rollback ZIPs and a hash manifest locally. It executes only the local ZIP utility, with fixed timestamps, permissions, sorted entries, and stored bytes. It has no deployment or AWS execution path.

The implementation deliberately keeps the original provider, environment variable names, product table, AWS SDK v3 runtime dependency, and Lambda handler `index.handler`. No new resources or IAM grants are needed.

## Verification evidence

The first regression run against the unmodified deployed source produced **3 passes / 5 expected failures**: warm success, unsafe warm overrides, provider failure propagation, incomplete cache-write propagation, and empty-source failure were missing. The ordinary HTTP compatibility checks passed.

After the final merchant, logging, and pagination review repairs, `node --test tests/legacy-catalog.cjs` completed with **20 tests, 20 passes, 0 failures** on Node.js v24.18.0:

1. Original deployed schedule input reproduces 404 with no provider/cache activity.
2. Warm requests one bounded Nike-only CJ page and persists at most 20 products.
3. Extra warm fields fail before credentials, network, or writes.
4. Provider failure rejects the scheduled invocation.
5. Unprocessed writes fail after three bounded batch attempts.
6. Empty source results do not report a successful warm.
7. Existing CJ list response and fresh detail-cache behavior remain compatible.
8. Ordinary HTTP upstream failures preserve a safe 502 response.
9. Candidate and rollback packages reproduce byte for byte; rollback source equals the verified original; candidate contains only its two required runtime files.
10. Unapproved merchant/URL rows cannot be cached or claimed as successfully warmed Nike products.
11. Mixed pages retain valid Nike and Jordan-brand products while rejecting foreign merchant rows.
12. Unapproved detail responses cannot populate the cache.
13. Fresh previously unapproved cached records cannot bypass merchant checks.
14. Malformed credential JSON cannot leak even a short prefix into logs or HTTP responses.
15. SDK exception text cannot leak credential fragments into logs.
16. An unexpected configured advertiser fails before credential/provider access.
17. Detail responses cannot substitute another source product ID.
18. Sparse filtered pages retain raw progression and original absolute product positions without persisting pagination metadata.
19. Fully rejected pages preserve continuation to later provider rows.
20. Raw pagination remains bounded and stops on empty/exhausted sources or the existing offset boundary.

The new review regressions were observed failing before implementation, including the short malformed-credential prefix that V8 includes in JSON parser errors. Pagination tests also failed before `rawCount`/`nextOffset`/`sourceIndex` were implemented. The exact deployed-source fixture and provenance metadata remain unchanged.

These tests run real module/cache/packaging logic with only AWS SDK and provider boundaries simulated. No live provider test was run for this patch.

`node backend/legacy-catalog/build.cjs` completed successfully and produced:

| Package | Size | SHA-256 |
|---|---:|---|
| candidate.zip | 10,503 bytes | `915276662c3b84e679f89861980d0ee583b6d6a654cc8f2a655a8305e72ee386` |
| rollback.zip | 4,763 bytes | `b71fb0b7e755cfca94c9cb0b70db91e953505446cd2ee36b2d6fc8a334794a55` |

The independent broader `npm test` run at this stage reported **350 tests, 349 passes, 1 failure**: `archive plus separate HTML retains every source needed by the real canonical build checks` in `tests/export-review.cjs`, with `Private or unsafe path in release inventory`. The new per-directory `.gitignore` was rejected by the export inventory. The root task owns that integration fix and the final full-suite result; this report does not claim that earlier full run passed.

A later full-suite run after the final source edits and before root regenerated the shared artifacts reported **377 tests, 373 passes, 4 failures**. All were generated-artifact drift: `production HTML embeds the canonical adapter and a valid CSP hash`, `full client bundle is deterministic, canonical and protected by the actual inline CSP`, `commerce template and inline runtime are reproducible and syntactically valid`, and `archive plus separate HTML retains every source needed by the real canonical build checks` (restored Commerce template differed from source). The root task owns regeneration and final verification; no legacy test failed in that run.

After regeneration, the root task reported the full Node suite passing **377/377**. That count includes the final **20 legacy tests** described above. No legacy runtime or test source changed after that run; only this verification note and evidence-document whitespace were finalized.

The latest read-only AWS reconciliation at **2026-10-17 12:49:35 UTC** found unchanged 500-search/200-detail monthly limits and paid usage disabled, with counters **86 searches / 44 details** and remaining **414 / 156**. That is 20/2 above the prior snapshot; this readback does not attribute the intervening activity. No provider requests or production changes were made for the check; historical entries were preserved in the evidence report.

## Deployment and rollback boundaries

The artifacts are review-ready preparation only. Deployment still requires explicit owner approval, a fresh check for live package drift, and preservation of the current package/configuration. Replacing the formerly ineffective warmer will cause real CJ requests on the existing schedule, so its usage and existing async retry policy must be reviewed before activation. No new schedule or retry expansion is proposed.

The candidate ZIP uses the existing `index.handler`, with `index.js` and `cj-handler.js`. The rollback ZIP contains the original verified source as `index.js`; its ZIP metadata differs from the original package but source identity is checked. Prefer restoring the exact package saved immediately before deployment. Rolling back to the original source also restores its known warm-404 limitation. Product and budget tables must not be cleared or reset during rollback.

Detailed local build, deployment verification, and rollback steps are in [the module README](../../backend/legacy-catalog/README.md). Generated ZIPs remain local ignored artifacts, reproducible from committed sources.
