# Candidate verification — 2026-10-26

Tested HTML SHA-256: `eb054d8216f98ec9a4a8bf0a235270e370e76875fea0b54fa33b1d0b2bdd8a82`. Node 24.18.0, Playwright 1.63.0. All integration responses were synthetic and intercepted; no live API credentials were used.

| Gate | Result |
|---|---|
| `npm run build` / `npm run check` | Pass; canonical sources and production CSP verified |
| `npm test` | 420 passed, 0 failed/skipped |
| Catalog browser suite | 30 groups, Chromium/Firefox/WebKit |
| Commerce browser suite | 78 groups, desktop/mobile across all three engines |
| Icon browser suite | 562 checks, 12 viewport runs |
| Existing icon review | 120 comparisons + 40 matched detail checks per engine |
| Hardening browser suite | 18 scenarios across all three engines |
| Cinematic browser suite | 264 checks, six engine/viewport runs |
| Isolated preview | Direct entry without worker fails closed; normal gallery/variant/cart/disabled-payment flow passes in all three engines |
| New comparison page | All 21 states × mobile/desktop images; controls at 320/1440px, all three engines |
| Extended responsive matrix | 156 checks, six additional widths/orientations |
| Additional final Firefox/WebKit capture | 52 checks, four viewport runs |
| Independent correction review | 96 retailer/generic-query/language cases; selector heights confirmed in all engines |
| Performance / accessibility fallback | 12 paired lab runs; no measured material regression; details in PERFORMANCE.md |

The full required browser command ran successfully on the final production HTML. After extending the review-only test to cover every comparison image, that script was rerun successfully in all three engines; production files did not change. CI must still run on the published PR head. GitHub CI evidence is recorded with the publication receipt and PR, not assumed from local results.

## Visual evidence

146 curated, unmodified actual-browser PNGs: 60 matching baseline, 64 candidate (including four retailer views), 12 responsive examples and 10 Firefox/WebKit examples. The interactive review provides paired dark/light/Arabic/product/failure/customer-journey states. Complete generated capture reports retain behavioral checks; omitted duplicate/debug images are archived locally. The photograph and packshot artwork are synthetic and fixture-only.

The parent inspected final mobile controls, narrow/tablet/wide composition, WebKit PDP, Firefox Arabic, retailer Arabic and the real comparison page. Independent review inspected 13 core screen captures plus retailer corrections and real actionability. Findings and their limits remain in INDEPENDENT-REVIEW.md. No claim of complete WCAG certification or real-provider operation is made.

## Release procedure

This is a frontend review candidate. Obtain explicit owner approval before merge or deployment. Preserve the existing required CI and deploy through the existing frontend release workflow only. No AWS deployment is needed for the visual changes. If a released visual regression occurs, revert this frontend PR through a reviewed Git revert and redeploy the previous frontend artifact; never reset backend resources or customer data. Existing operational hardening rollout decisions remain separate.
