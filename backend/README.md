# Channel3 catalog proxy

`index.js` is the source of the existing `AnoX-Channel3-Catalog` Lambda. `build-template.cjs` embeds it byte-for-byte in `cloudformation.json`, preserving the `Channel3Function` logical ID, physical name, Node 24 runtime, timeout and memory. API Gateway routing and invocation permissions are outside this stack and are unchanged.

Generate with `node backend/build-template.cjs`; verify source/template identity with `node backend/build-template.cjs --check`. Run the network-free backend tests with `node --test tests/backend*.cjs`. This directory performs no deployment automatically.

## Public contract

`GET /catalog/search` accepts either nonempty `q` or a supported `section`, `limit` from 1 to 24 (default 24), optional `page_token`, and optional `filters` JSON. Unknown or duplicate parameters are rejected. Search text is NFC-normalized, trimmed, and consecutive whitespace collapsed; case is retained. Its normalized length is at most 100 characters. C0/DEL controls and malformed UTF-16 are rejected. A missing/empty search must select `section=featured` explicitly; it never silently becomes another query.

Sections: `featured`, `men`, `women`, `shoes`, `clothing`, `beauty`, `accessories`, `sports`, `brands`. Their fixed backend queries are versioned in `SECTIONS`. Only the requested section runs. These sections use product search, not separate upstream brand/category APIs.

The supported filter subset is `conditions` (`new`, `used`) and `availability` (`InStock`, `OutOfStock`), each containing one or two entries. Arrays are sorted and deduplicated; object-key order is immaterial. Unknown fields/values fail before upstream access. The frontend's other display filters remain local.

Continuation tokens retain exact text, including surrounding spaces and punctuation, and are capped at 8,192 characters. They are accepted only when issued for the identical provider/mode/section/query/filter/limit context. A chain has a 30-minute lifetime and a 500-source-record traversal limit, including source records discarded during sanitization. Local unknown/mismatched tokens return `400 CURSOR_INVALID`; expired mappings return `410 CURSOR_EXPIRED`. Upstream 400/404/410/422 on a continuation returns `410 CURSOR_INVALID`: this means the continuation cannot be used, not that Channel3 documented a particular expiry. No failure silently restarts at page one.

Successful responses are `{provider:'channel3',data:{products,next_page_token},fetchedAt,expiresAt}`. An exhausted page has a null token. Only bounded product fields, USD offers linking to `buy.trychannel3.com`, and one primary image from `cdn.trychannel3.com` are retained. The proxy never establishes purchase eligibility, stock reservation or payment authority.

## Cache and failure behavior

SHA-256 keys include contract version, provider, mode, section, normalized query, canonical filters, limit and cursor. No raw query or cursor is stored in the key. Cached payloads contain the necessary next token, with table access restricted to the dedicated runtime role. Search freshness is five minutes; discovery freshness ten. Application timestamps enforce expiry independently of asynchronous DynamoDB TTL cleanup. Responses are never served stale.

Strongly consistent reads plus conditional 25-second leases coordinate different Lambda instances. One process also coalesces matching promises. The owner rechecks the cache after acquiring a lease, then atomically stores the page/cursor mapping and deletes its owned lease. Waiters poll for at most six seconds; a failed winner is not automatically retried by a waiter. A later deliberate request can retry. Abandoned leases expire, and conditional publication prevents a previous owner writing after lease loss. Cache failures fail closed without bypassing the cache. DynamoDB transport is bounded to 1.5 seconds per operation; the SDK may retry an AWS operation, but an upstream Channel3 POST is never automatically retried.

Upstream requests have a ten-second timeout, reject redirects and non-JSON content, and read at most 2 MiB. Sanitized responses are capped at 300 KiB, below DynamoDB's item limit including metadata. Malformed responses/errors are not stored as successful pages. Product identities are not fabricated.

Only named CloudWatch EMF counters are logged: `cache_hit`, `cache_miss`, `upstream_request`, `upstream_failure`, `cache_contention`, `cache_error`. No query, token, cache key, request/response body, API key, headers or customer data is logged.

## Deployment boundary

The template adds one on-demand DynamoDB table with TTL and one dedicated role. It does not modify the CJ `AnoX-Products` table or the shared `AnoX-Catalog-API-Role`. The cache table is retained on stack deletion/replacement; it is disposable cached data, not an order store. The dedicated role has only Get/Put/Delete on that table (including the corresponding transaction operations), GetSecretValue on the provided exact Channel3 secret ARN, and stream/write permissions on the existing `/aws/lambda/AnoX-Channel3-Catalog` log group. That existing log group must remain present; this template does not attempt to recreate or import it.

The deployed Lambda lazily resolves its configured secret with the AWS SDK and caches it in memory for five minutes. It supports the existing raw string, `apiKey`, `api_key`, or `key` formats. Agent tooling and tests never retrieve its value. Tests use synthetic strings and injected transports. The Node 24 Lambda runtime supplies AWS SDK v3 clients; local unit tests do not require them or AWS credentials.

CloudFormation synthesis/validation is separate from deployment. Only the deployment operator can establish actual role propagation, runtime SDK availability, secret access, table writes and HTTP API behavior. Browser CORS is preserved as `https://anox.app`; CORS itself is not authentication or a server-side abuse limit.
