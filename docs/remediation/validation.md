# Final remediation verification

October 13, 2026. Branch `feat/anox-commerce-foundation`, baseline `7958718de6d859da1c809abef7b98e012a857973`. The exported manifest identifies the exact final commit/tree and every file hash. **These results do not authorize deployment or establish operational checkout.**

| Verification | Executed result | Evidence and limits |
| --- | --- | --- |
| Complete Node suite, `npm test` | 225 passed, 0 failed/skipped; exit 0 | [Complete output](node-tests.txt). Real modules and generated runtimes with injected transports; not live provider/AWS/Stripe operations. |
| Official build and parity, `npm run build` / `npm run check` | Both exit 0 | Catalog/auth/commerce inline parity, both generated templates, complete inline syntax and exact CSP verified. No build deploys resources. |
| Chromium and Firefox catalog | 16 groups passed | Three cursor pages, overlap deduplication, search reset/stale response, independent sections, empty storefront, single-image cards and CSP. |
| Chromium and Firefox commerce, desktop/mobile | 48 groups passed | Exact merchant/variant and direct links, ambiguous/unknown offers, gallery failure/retry, cross-product edits, cart tabs/accounts/erase/corruption, quote price changes/expiry and staged-API 404/reconnect with no legacy payment fallback. |
| Existing embedded self-tests | 135/135 per engine | Executed by catalog browser suite; no exemptions. |
| CloudFormation lint | Both templates pass, exit 0 | cfn-lint 1.46.0. Catalog 57,354 bytes; commerce 67,130 bytes. |
| CloudFormation Guard | Both templates pass, exit 0 | Guard 3.2.1, catalog and commerce rule files. No upload/change set/stack execution. |
| Release tooling | 23 tests pass (13 exporter, 10 preflight) | Included in the 225 count. Independent adversarial review caught false-positive preflight inputs; corrected and retested. |
| JavaScript syntax / whitespace | Pass | `node --check` on changed standalone modules/tooling plus complete inline syntax in build checks; `git diff --check`. |
| Quote limit profile | Recorded offline | [Raw profile](quote-profile.json): five distinct selections/ten lines, max three simultaneous reads; 5-second reads reach the nine-second deadline without records/audits. No live latency claim. |
| Real AWS | Read-only metadata and safe rejection probes | [HTTP results](aws-http-probes.json); [source/deployed comparison](release-assessment.md). New endpoints absent. |

[Machine-readable summary](validation.json) and [all browser check results](browser-results.json) accompany the complete test output. Browser runs used the pinned Playwright 1.63.0 from the existing local installation, with Node v24.18.0; archive construction used Python 3.9.6. Chromium/Firefox desktop and touch-capable mobile viewport coverage is explicit in the browser evidence. External network is intercepted in those suites. Zero unexpected requests, runtime errors or CSP violations were accepted by the harness.

Local reproduction:

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
npx playwright install chromium firefox
ENGINES=chromium,firefox npm run test:browser
cfn-lint backend/cloudformation.json backend/commerce/cloudformation.json
cfn-guard validate -d backend/cloudformation.json -r backend/catalog.guard
cfn-guard validate -d backend/commerce/cloudformation.json -r backend/commerce/commerce.guard
```

The local session used `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_BROWSERS_PATH` pointing to the existing `checkout-release` installation; a normal locked install does not need those overrides. Export reproduction instructions and per-file checksums are in `manifest.json`. Keep the separate, untruncated `index.html` in the extracted archive root before running checks.

The historical Phase 1 evidence already demonstrated three real cursor pages with 69 unique products, cached replay/expiry, invalid cursor rejection and 24→47 browser cards through AWS; see [Phase 1 validation](../phase1/validation.md). This review did not repeat paid cache-miss searches just to inflate evidence. Current safe probes return 404 for undeployed commerce/detail, 401 for unauthenticated protected legacy routes, and 400 for an unissued cursor. New real Cognito/DynamoDB/IAM/CORS/merchant and payment acceptance remains unexecuted and blocked by approval/external dependencies.

No unresolved automated test failure remains in this revision. Intermediate red regression failures were intentional and corrected; working-tree tests run during concurrent edits were not treated as final results. Exporter and preflight failures found during independent review were reproduced before correction. Full original/second-review findings are in [completed fixes](completed-fixes.md), [security](security-findings.md), [product](product-findings.md) and [cost](channel3-cost.md). Cloud and business blockers are open in the [issue register](release-assessment.md); test success does not waive them.

The [saved offline preflight result](preflight-results.json) intentionally reports **not ready** for backend and frontend. Historical evidence is not a fresh deployment attestation, and reviewed bucket/source/alarm/function-plan inputs are missing. The helper checks selected operator-supplied metadata only; neither its inputs nor a future passing result can authorize deployment or payments.
