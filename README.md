# AnoX storefront

The deployed page is the complete root `index.html`. The canonical live catalog adapter is `catalog-live.js`; its inline copy and the page's CSP hash are generated together. Edit the canonical adapter, then run `npm run build`. Do not edit its embedded copy. The rest of the page remains authored in `index.html`.

The Channel3 Lambda source and generated CloudFormation template are in [`backend/`](backend/README.md). `npm run build` also generates that template, so neither deployed copy can silently diverge from its source. No build or test command deploys AWS changes.

With Node 24:

```sh
npm ci
npm run build
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

The browser test serves the real HTML at an intercepted `https://anox.app` origin with its CSP enabled, and replaces external API/image responses with fixtures. `ENGINES=chromium,firefox` tests both installed engines. The existing 135 embedded self-tests retain one verified pre-existing failure: their favicon assertion expects an embedded image, while production uses `/favicon.svg?v=3`. The browser runner rejects any additional baseline failure.

The optional `scripts/smoke-deployed.cjs --live` and `scripts/browser-live-catalog.cjs --live` checks contact the deployed AWS catalog and may consume Channel3 credits on cache misses. Their metered calls are intentionally bounded. See [`docs/phase1/validation.md`](docs/phase1/validation.md) for release evidence and limitations.
