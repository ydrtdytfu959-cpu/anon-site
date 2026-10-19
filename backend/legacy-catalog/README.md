# Legacy CJ catalog warmer

This source repairs the verified mismatch between the deployed `AnoX-Catalog-Warm-V2` schedule's `{"action":"warm"}` input and the `AnoX-Catalog-API` handler, which currently returns 404 for that input. Nothing in this directory deploys a function, changes a schedule, or contacts a provider during build/test.

`deployed-index.js` is the exact 4,649-byte source downloaded from the deployed Lambda ZIP. Its hashes and current runtime/event contract are recorded in `provenance.json`. `cj-handler.js` preserves that CJ-only HTTP behavior in readable source; `index.js` adds the bounded warm action.

## Behavior

- A warm invocation accepts exactly `{"action":"warm"}`, requests one CJ page at offset 0 and limit 20 for the existing configured Nike advertiser, and writes at most 20 product records to the existing table.
- Other warm fields are rejected before any secret access or provider call. No Channel3 credential, endpoint, Lambda, budget table, or permissions are used.
- Original HTTP fields remain compatible; list responses add `rawCount`, `nextOffset`, and each accepted product's absolute `sourceIndex` so filtering cannot corrupt pagination. Detail cache freshness remains six hours. This repair does **not** add offline list browsing or claim six-retailer coverage.
- Accepted rows must match official Nike advertiser `4942550`, the Nike advertiser name, and an HTTPS `nike.com` or `www.nike.com` destination without credentials or a nonstandard port. Manufacturer brands such as Jordan remain supported. List, warm, cached detail, and provider detail paths all enforce merchant identity; detail responses must match the requested source product ID.
- Parser and SDK exception messages are never copied into logs or error responses. Credential JSON failures become a fixed error, and the outer catch logs a fixed event name. Provider diagnostics contain only numeric status/error counts.
- Provider failure, empty warm results, or exhausted DynamoDB unprocessed-write retries fail the warm invocation. Cache writes retain the existing maximum of three batch attempts. The list path now also caps returned/persisted rows at the requested limit and returns 502 if cache writes remain unprocessed, rather than silently dropping them.
- Existing scheduled-delivery and Lambda retries can repeat a warm invocation. Writes use stable product keys, but repeated provider queries are still possible. This patch neither increases schedule frequency nor adds a new retry policy. A deployment review must account for existing async delivery behavior and CJ permissions/usage.

## Build and local verification

Requires Node.js 24+ and the standard `zip` executable. The Lambda continues to use the AWS SDK v3 packages supplied by its current Node.js runtime, as the verified deployed source does.

```sh
node --test tests/legacy-catalog.cjs
node backend/legacy-catalog/build.cjs
```

The build creates ignored local `artifacts/candidate.zip`, `artifacts/rollback.zip`, and `artifacts/manifest.json`. ZIP entries have fixed timestamps/permissions and no compression or extra metadata. Repeated builds produce the same bytes. Both packages retain handler `index.handler`.

The candidate ZIP contains only `index.js` and `cj-handler.js`. The rollback ZIP contains the exact verified original source as `index.js`. Its ZIP metadata differs from the original deployed package; source identity is preserved and independently checked before building.

## Owner-approved deployment and rollback

No deployment is authorized by this source change. When the owner separately approves deployment:

1. Re-read the live function configuration and package hash. Compare with `provenance.json`; stop and review drift before replacing a changed package. Save the then-current package/configuration and inspect async retry settings.
2. Review the local manifest and passing tests. Update **only** the existing function's code to `candidate.zip` through the established owner-approved deployment process. Do not create resources, modify environment variables, change budgets, or update the schedule.
3. Confirm `LastUpdateStatus=Successful` and compare Lambda `CodeSha256` with the candidate manifest. Verify normal HTTP list/detail behavior and the next authorized scheduled warm. Warm success must include a nonzero `warmed` count and acknowledged cache writes; approve any manual provider-bearing invocation separately.
4. For rollback, restore the package saved immediately before deployment. If it matches the audited baseline and the exact saved ZIP is unavailable, the generated `rollback.zip` restores the verified source behavior, including the known old warm-404 limitation. Verify the restored hash and HTTP routes. Never reset or delete product/budget tables as a rollback step.

Removing the legacy function's unused Channel3 environment reference/IAM grant is a separate reviewed infrastructure change. The candidate requires only its existing CJ secret permission and product table GetItem/BatchWriteItem permissions.
