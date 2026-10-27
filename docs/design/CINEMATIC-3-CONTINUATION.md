# Cinematic Commerce 3.0 — continuation

Updated 2026-10-26. Branch: `design/anox-cinematic-commerce-20261025`.
Baseline: merged hardening PR #28, `4c019a69d3771e60b3632497092fa987d91f6309`.
First implementation milestone: `36ef76d`. Use `git log -1` for the latest evidence/integration commit; the current document cannot embed its own commit hash.

## Completed and verified

- Canonical Cinematic stylesheet and deterministic build/CSP integrity checks; no runtime dependencies.
- PDP image composition, floating mobile information panel, native source options, merchant attribution, price/freshness states, wishlist and gallery controls.
- Home/discovery/category/cards, retailer-specific headings/current states, wishlist/cart, account/auth, service/order/policy and search/assistant surfaces. Existing routes and business controllers retained.
- Native WebKit selectors now have scalable 52px height (104px at 200% text). Arabic gallery counter and retailer names isolate Latin/numeric direction.
- Offline interactive preview and matching screenshot review. Direct entry cannot initialize production clients before the exact isolation worker controls the page; external requests/server mutations blocked. The server never writes production HTML.
- Independent review found and verified corrections for preview direct-entry isolation and retailer orientation. All three engines passed 96 additional independent route/language cases; see `docs/cinematic/INDEPENDENT-REVIEW.md`.
- Final HTML SHA-256: `eb054d8216f98ec9a4a8bf0a235270e370e76875fea0b54fa33b1d0b2bdd8a82`.

## Verification

`npm run build`, `npm run check` and `npm test` passed: **420 Node tests, zero failures**. Full `ENGINES=chromium,firefox,webkit npm run test:browser` passed the existing catalog/commerce/icon/hardening suites plus **264 Cinematic checks** and isolated-preview flows. The subsequently extended review-page script separately passed all 21 comparison states at both screenshot sizes and 320/1440px review layouts in all three engines.

Final matching baseline/candidate evidence: 60 / 64 Chromium screenshots. Additional final responsive check: **156 checks** over 320, 375, 430, 768, 1920 and 844×390; 12 representative images retained. Final Firefox/WebKit capture check: **52 checks**, with 10 representative images retained. All capture reports identify the tested HTML hash. Additional generated images are retained locally under ignored `test-results/cinematic-evidence-archive`, not required for the review page.

Performance: 12 paired fresh-context Chromium runs and accessibility fallback checks passed. Compressed HTML +1.25%; standard/constrained median LCP 88/664ms, startup CLS 0 under isolated local fixtures. Not field Core Web Vitals, actual cellular transfer, or physical Safari evidence. See `docs/cinematic/PERFORMANCE.md` for limits and reproduction.

## Publication and exact next action

At this checkpoint the reviewed implementation/evidence is committed locally and GitHub publication is the only unfinished delivery stage. A remote branch/PR search found no existing Cinematic PR. Normal authenticated Git push is unavailable (no credential; prompt disabled), so publish immutable objects through the authenticated GitHub connector, verify the remote tree equals the committed local tree, create one dedicated review PR and inspect its actual CI.

Publication object receipts and the final PR/head/CI status are saved alongside the repository in `../anox-cinematic-publication/`; inspect them before retrying uploads. Reuse blobs by their Git SHA. Do not repeat implementation or regenerate evidence unless a relevant defect is found.

Local preview: `npm run preview:cinematic` (127.0.0.1:8787). Open `/docs/cinematic/preview.html` for comparisons or `/preview/` for the isolated interactive application. No authorization for merge/deploy. Leave production unchanged.

## Preserved boundaries and remaining limits

Catalog/auth/commerce canonical modules and all backend/AWS files remain byte-identical to the baseline. No provider quota, payment, merchant purchase, customer-data or infrastructure operations occurred. Fixtures prove layout/interaction behavior, not real retailer coverage. Native device keyboard, assistive technology and real-user performance remain unmeasured. The broad frontend redesign still needs owner visual approval before release.
