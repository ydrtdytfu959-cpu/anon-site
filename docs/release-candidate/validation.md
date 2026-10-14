# Release candidate verification

October 14, 2026. Branch `feat/anox-commerce-foundation`; baseline `dd11ddedf277d74446d77af6836a67ee30abebf7`. The final archive manifest pins the candidate commit/tree and source hashes. **All browser/backend tests below are local fixtures unless explicitly classified otherwise. No deployment or commercial integration is certified by them.**

| Command/check | Result | Evidence |
| --- | --- | --- |
| `npm ci --ignore-scripts` | Exit 0, locked install completed | [Output](npm-ci.txt). Node v24.18.0, Playwright 1.63.0. |
| `npm run build` | Exit 0 | [Output](build.txt). Three canonical templates and embedded browser modules/CSP generated. |
| `npm run check` | Exit 0 | [Output](check.txt). Three template-source parity checks, standalone/embedded consistency, full inline syntax and exact CSP. |
| `npm test` | **263 passed, 0 failed/skipped/cancelled**, exit 0 | [Complete output](node-tests.txt), [command record](command-results.json). Includes hostile contracts, cache/cursors/concurrency budgets, money/ownership/idempotency, delivery, staging, exporter and preflight. |
| `ENGINES=chromium,firefox npm run test:browser` | **20 catalog + 48 commerce groups passed**, exit 0 | [Complete output](browser-results.txt), [structured checks](browser-results.json). Both engines, desktop/mobile commerce. |
| Embedded HTML self-tests | **135/135 per browser engine** | Included explicitly in catalog checks; no exemptions. |
| `cfn-lint backend/cloudformation.json backend/commerce/cloudformation.json backend/staging/cloudformation.json` | Exit 0 | [Output](cfn-lint.txt); cfn-lint 1.46.0. |
| CloudFormation Guard, each template with its corresponding rule file | All three exit 0 | [Commands/status](infrastructure-results.json), catalog/commerce/staging Guard logs. Guard 3.2.1. |
| `node --check` across standalone JS/CJS sources, scripts and tests | 57 files, all exit 0 | [Per-file results](syntax-results.json); full HTML inline syntax checked by official build checker separately. |
| `git diff --check` | Exit 0 | No whitespace errors at final source review. Final committed-tree checks are also included in the external artifact-verification record. |
| Infrastructure preflight | Intentionally **not ready** | [Saved result](preflight-evidence.json) evaluated captured metadata with stale-evidence and unapproved artifact/quota/deployment prerequisites. No mock passing input is represented as cloud readiness. See staging runbook/evidence. |
| Committed export/rebuild/checksum verification | Recorded with final package | `artifact-verification.json`, manifest and SHA256SUMS beside the exported full HTML/ZIP. Verify those records before using the artifact; not an infrastructure deployment. |

The browser command used the pinned locked local Playwright package and existing installed engines via `PLAYWRIGHT_BROWSERS_PATH=/Users/anestifour/Documents/New project/checkout-release/.browsers`. Both suites intercept API/image traffic and execute the actual HTML with production CSP. Commerce fixtures invoke the real handler through injected transactional state. They prove visible behavior and contract handling, **not** real Cognito signatures, DynamoDB concurrency, provider pricing, carrier serviceability or Stripe operations. Unexpected requests, runtime errors and CSP violations are failures.

Final generated sizes: `index.html` 1,039,759 bytes; catalog template 56,460 bytes; commerce template 74,402 bytes; isolated staging template 134,149 bytes. All templates exceed the 51,200-byte inline limit and require the reviewed private TemplateURL path; all remain below 1 MiB. Final hashes are in the manifest. HTML SHA-256 before commit: `cfff1a8277f8f59b1e5820ba7180d903361ee3e094aeb3056155aa4d53430cc0`.

## Regression and independent-review evidence

The candidate's observed failing regressions and corrections are listed in [completed-fixes](completed-fixes.md). Independent review checked cached volatile fields/null prices, stable spending identities, client/server admission, exact delivery evidence, staging runtime/client compatibility and rollout/recovery assumptions. The duplicate-selection test first failed for a missing rejection, then passed without losing distinct merchant/condition support. The staging login/schema expectation and delivery service-reference failures likewise preceded their corrections.

During concurrent source editing an intermediate complete suite reported 254/257 passing, with three generated-parity failures (client bundle, commerce template, exporter reproduction). These were resolved by the official final build; the final 263-test run above has no exemptions or suppressed failures. Earlier red tests are development evidence, not unresolved failures. The extra tests are contract coverage, not a reason by themselves to claim greater production readiness.

## Real-service evidence and unexecuted gates

Fresh read-only AWS captures are [API/routes/quota](aws-state.json), [table protection](aws-tables.json), [shared-key roles](aws-shared-key-roles.json), [function invocation boundaries](aws-function-boundaries.json), [legacy processed-source hashes](aws-legacy-source-hashes.json) and [catalog warmer](aws-catalog-warmer.json). Each records its own timestamp/call status. They confirm existing resources and open prerequisites. Processed legacy code matches the previous audit after removing its appended export newline; actual deployed ZIP parity is still unverified.

Initial metadata attempts were prevented by a tool validator and then automatic approval-review capacity failures; no unsafe-action determination or cloud call occurred on those failed attempts. Later authorized read-only retries succeeded and are the evidence cited here. No alternative identity/tool was used to bypass approval review.

No new paid Channel3/cache-miss search, carrier quote, payment, merchant order or deployed commerce test ran in this candidate. Historical Phase 1 real cursor/cache/browser evidence remains under `docs/phase1/`; it is not a fresh test of this candidate. Historical safe unauthenticated production rejection probes remain under `docs/remediation/`. Actual two-customer JWT, conditional-write contention, scoped invocation, metrics/notification, cold-start/throttle, staging mobile and rollback acceptance remain **NOT EXECUTED — approval/resources required**, as classified in [infrastructure-staging.md](infrastructure-staging.md).

Release A may proceed to independent review with these limits; it is not ready for controlled deployment. Release B remains blocked by external purchasing/payment/delivery authorization and unimplemented operational recovery capabilities.
