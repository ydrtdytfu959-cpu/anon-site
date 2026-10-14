# Phase 1 catalog design

Implement the user's Phase 1 request on `feat/channel3-catalog-phase1`, based on main `9b81ec5c1a791f3aacec4fc3df503bef742c9a84`. Do not merge or change commerce, auth, payment, shipping, or fees. Deliver the complete generated root index.html and a PR.

## Evidence and boundaries

The deployed HTTP API is `zmumi2wruk` in us-east-2, AWS account 427064007352. GET /catalog/search invokes AnoX-Channel3-Catalog. The existing CloudFormation stack contains a Node 24 inline Lambda reading AnoX/Channel3/Production from Secrets Manager; it forwards query/limit without pagination or caching. CORS allows only https://anox.app. The existing AnoX-Products table stores CJ/Nike data, uses productId plus an advertiser index, and has TTL disabled. A separate small on-demand DynamoDB cache table avoids changing its data model or cleanup semantics. The Channel3 function currently shares a CJ role; give it a dedicated role scoped to its secret, cache, and log group. Do not alter CJ permissions.

Official upstream contract: POST https://api.trychannel3.com/v1/search; JSON body query, limit, filters (when provided), page_token. Response products and next_page_token (null when exhausted). Keep query/filter/limit fixed across a cursor chain. Documentation maximum limit is 30 and traversal 500 products; AnoX limits list pages to 24 to preserve its 4,000,000 declared-pixel budget. No documented cursor lifetime or cursor-specific error semantics; reject unusable cursors without silently restarting.

Sources: https://docs.trychannel3.com/api-reference/v1/search ; https://docs.trychannel3.com/sdk/pagination.md ; https://docs.trychannel3.com/guides/caching

## Interfaces

Browser GET /catalog/search accepts q (search text), section (discovery identifier), limit 1..24, page_token (opaque continuation), filters (bounded supported JSON). Search and discovery are separate contexts. Backend returns {provider:'channel3',data:{products,next_page_token},fetchedAt,expiresAt}; safe cache metadata may be included. Preserve upstream token text, never normalize it. Server validates a returned token's association with its canonical context before spending another credit. Invalid/expired cursors return a safe 400/410 error requiring explicit restart.

Supported lazy discovery sections: featured, men, women, shoes, clothing, beauty, accessories, sports, brands. Homepage uses one selected section; links select independent results and cursors. No eager per-section fanout. Search starts a separate context and never uses a discovery fallback for nonempty text. Filters currently displayed locally remain local unless explicitly sent in the supported backend filter contract.

Repository entries are keyed by provider/context/query/filter/limit, retain their own cursor, deduplicated IDs, status, expiry, in-flight work and cancellation generation. The active context determines public live presentation; loaded records remain resolvable for detail links. Repeated Load More clicks coalesce. Superseded requests cannot overwrite active results. An append error retains accepted products and cursor for deliberate retry; invalid continuation offers explicit restart. Limit memory and context retention. Offset providers retain their existing protocol.

## Cache and usage

Use a dedicated DynamoDB table with deterministic SHA-256 keys over canonical version/provider/mode/section/query/filters/limit/cursor. Search freshness 5 minutes, discovery freshness 10 minutes, finite retention with application expiry checks (DynamoDB TTL deletion is asynchronous). No stale prices silently served. Persist a bounded allowlisted response containing one primary image per product; never upstream error bodies or credentials. Scope cursor acceptance to query context and a bounded browsing lifetime. Use conditional expiring leases plus in-process single-flight so identical cold misses do not fan out. Cache failures fail closed rather than bypassing the cache and wasting credits.

Structured CloudWatch events/EMF count cache_hit, cache_miss, upstream_request, upstream_failure, plus safe contention/cache errors. No raw query, cursor, body, API key, headers, or customer data in logs. No automatic upstream retries that silently consume credits.

## Source of truth and verification

Two Channel3 adapters already diverge: root catalog-live.js and an inline copy in index.html. Preserve the stricter active inline adapter as the baseline; make catalog-live.js the canonical adapter. A deterministic build replaces only its delimited inline module and regenerates the script CSP hash. Check mode rejects divergence and stale hashes; CI runs it. Other legacy files remain untouched.

Tests: adapter contract, three pages/overlap/end, context/reset/race/abort/error handling, provider state, image/payload limits, cache identity/miss/hit/expiry/malformed data/concurrency/failure, real endpoint calls capped to a small explicit smoke sequence, browser list/Load More/context flow, complete JS syntax and CSP. Read existing embedded self-tests and run them safely where compatible. Review all changes independently and again for concurrency, credit waste, security, and backward compatibility before committing and opening the unmerged PR.
