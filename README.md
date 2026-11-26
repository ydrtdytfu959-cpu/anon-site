# AnoX storefront

The deployable page is the complete root `index.html`. The canonical browser modules are `catalog-live.js`, `auth.js` and `commerce-client.js`; their inline copies and the page's CSP hash are generated together. Edit the canonical source, then run `npm run build`. Do not edit embedded copies. The rest of the page remains authored in `index.html`.

The Channel3 Lambda source and generated CloudFormation template are in [`backend/`](backend/README.md). The separate, staged commerce service is in [`backend/commerce/`](backend/commerce/README.md). `npm run build` generates both templates, so deployed copies cannot silently diverge from their sources. No build or test command deploys AWS changes.

Product details, saved cart selections and server quotes are implemented for review. Merchant purchasing, financial collection and guaranteed delivered totals remain unavailable until supported integrations and commercial approvals exist. The commerce routes were deployed in October 2026; deployment status and current operational readiness must be verified against AWS rather than inferred from this README. Checkout and fee collection remain disabled. The current [release candidate assessment and issue register](docs/release-candidate/release-assessment.md), [validation](docs/release-candidate/validation.md), [cost policy](docs/release-candidate/channel3-cost-and-compliance.md), [checkout activation specification](docs/release-candidate/checkout-activation-spec.md), [Algeria delivery requirements](docs/release-candidate/algeria-delivery.md) and [deployment/rollback runbook](docs/release-candidate/deployment-and-rollback.md) continue the preserved historical evidence in `docs/remediation/` and `docs/commerce/`.

With Node 24:

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
npx playwright install chromium firefox
ENGINES=chromium,firefox npm run test:browser
```

The browser tests serve the real HTML at an intercepted `https://anox.app` origin with its CSP enabled, replacing external API/image responses with fixtures. Commerce fixture requests execute the actual backend handler with injected transactional storage; they are not live AWS or payment-sandbox tests. `ENGINES=chromium,firefox` tests both installed engines. All 135 embedded self-tests must pass. The outdated favicon assertion now checks the existing same-origin `/favicon.svg?v=3` asset.

The optional `scripts/smoke-deployed.cjs --live` and `scripts/browser-live-catalog.cjs --live` checks contact the deployed AWS catalog and may consume Channel3 credits on cache misses. Their metered calls are intentionally bounded. See [`docs/phase1/validation.md`](docs/phase1/validation.md) for release evidence and limitations.

After committing the reviewed revision, run `node scripts/export-review.cjs /absolute/new/output-directory` to export the exact full HTML, backend/source ZIP and commit/checksum manifest. Keep `index.html` beside the extracted archive sources to reproduce the build. Export refuses uncommitted changes.

## Operational release preflight

For frontend promotion, `scripts/release-preflight.cjs` now requires the live catalog search and authenticated service-request routes and a current, explicitly approved Channel3 budget. Provide `catalogBudget` in the private metadata input, using only the non-secret Lambda environment fields `BUDGET_MONTH`, `NEXT_BUDGET_MONTH`, `FREE_SEARCH_MONTHLY_CREDITS`, `SEARCH_DAILY_LIMIT`, `DETAIL_MONTHLY_LIMIT`, `DETAIL_DAILY_LIMIT`, `TOTAL_DAILY_LIMIT`, `UPSTREAM_PER_SECOND_LIMIT`, `PAID_USAGE_ENABLED`, and `PAID_SEARCH_MONTHLY_CREDITS`. Do not export secret references or credentials. The preflight checks the reviewed ceilings, not the actual provider balance; a separate provider allocation review is still required. Backend remediation is not prevented by an expired month.
