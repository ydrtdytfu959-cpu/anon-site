# AnoX storefront

The deployable page is the complete root `index.html`. The canonical browser modules are `catalog-live.js`, `auth.js` and `commerce-client.js`; their inline copies and the page's CSP hash are generated together. Edit the canonical source, then run `npm run build`. Do not edit embedded copies. The rest of the page remains authored in `index.html`.

The Channel3 Lambda source and generated CloudFormation template are in [`backend/`](backend/README.md). The separate, staged commerce service is in [`backend/commerce/`](backend/commerce/README.md). `npm run build` generates both templates, so deployed copies cannot silently diverge from their sources. No build or test command deploys AWS changes.

Product details, saved cart selections and server quotes are implemented for review. Merchant purchasing, financial collection and guaranteed delivered totals remain unavailable until supported integrations and commercial approvals exist. The new backend routes have not been deployed. The current [release assessment and issue register](docs/remediation/release-assessment.md), [validation](docs/remediation/validation.md), [cost policy](docs/remediation/channel3-cost.md), [checkout and shipping feasibility](docs/remediation/checkout-and-shipping-feasibility.md) and [deployment/rollback runbook](docs/remediation/deployment-and-rollback.md) supersede the historical implementation reports in `docs/commerce/`.

With Node 24:

```sh
npm ci
npm run build
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

The browser tests serve the real HTML at an intercepted `https://anox.app` origin with its CSP enabled, replacing external API/image responses with fixtures. Commerce fixture requests execute the actual backend handler with injected transactional storage; they are not live AWS or payment-sandbox tests. `ENGINES=chromium,firefox` tests both installed engines. All 135 embedded self-tests must pass. The outdated favicon assertion now checks the existing same-origin `/favicon.svg?v=3` asset.

The optional `scripts/smoke-deployed.cjs --live` and `scripts/browser-live-catalog.cjs --live` checks contact the deployed AWS catalog and may consume Channel3 credits on cache misses. Their metered calls are intentionally bounded. See [`docs/phase1/validation.md`](docs/phase1/validation.md) for release evidence and limitations.

After committing the reviewed revision, run `node scripts/export-review.cjs /absolute/new/output-directory` to export the exact full HTML, backend/source ZIP and commit/checksum manifest. Keep `index.html` beside the extracted archive sources to reproduce the build. Export refuses uncommitted changes.
