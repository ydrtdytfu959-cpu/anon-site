# Cinematic Commerce performance and fallback verification

Measured 2026-10-26 with Node 24.18.0 and Chromium 153.0.8010.12 on macOS arm64. This is an isolated laboratory comparison of the actual HTML and its CSP, using identical synthetic product responses and original fixture artwork. No provider, customer account, or production endpoint was contacted.

Baseline: merged PR #28, commit `4c019a69d3771e60b3632497092fa987d91f6309`; HTML SHA-256 `7c1a1aa928517a179948c58b284b81cc65869247ad33edb6377bfaeb3aa6a02d`.

Measured candidate HTML SHA-256: `eb054d8216f98ec9a4a8bf0a235270e370e76875fea0b54fa33b1d0b2bdd8a82`. The hash, rather than an earlier checkpoint commit, identifies the exact document measured. Raw observations are in [evidence/performance.json](evidence/performance.json).

## Payload

| Resource | Baseline bytes | Candidate bytes | Change |
|---|---:|---:|---:|
| HTML | 1,094,287 | 1,122,397 | +28,110 (+2.57%) |
| HTML, Node gzip default compression | 431,452 | 436,856 | +5,404 (+1.25%) |
| Inline CSS | 130,598 | 156,487 | +25,889 (+19.82%) |
| Inline script text | 685,047 | 687,268 | +2,221 (+0.32%) |

No new runtime package, remote font, or production image asset is required by the design. Script-text bytes include existing embedded content and do not measure parsed JavaScript alone. The stylesheet addition is the principal source increase. The compressed document remains large in absolute terms because the inherited document includes substantial embedded material; this iteration has not rebuilt its architecture.

The initial synthetic PDP returns three distinct image URLs, each with the same 1,758,888-byte fixture photograph, on both versions. Their combined response body is 5,276,664 bytes. Total fixture response bodies increase from 6,372,990 to 6,401,100 bytes solely because of the HTML change. These are uncompressed response-body counts, **not measured production network transfer**. The deliberately large original fixture photograph is not a production catalog asset and does not represent merchant image quality or compression.

## Browser measurements

Three fresh contexts per version per profile; baseline and candidate alternate. Viewport 390×844, device scale factor 1, mobile/touch emulation, real wall clock. All resource requests are intercepted and fulfilled locally. The constrained profile applies Chromium 4× CPU throttling and a 150 ms delay to every local response. It does not emulate cellular throughput, packet loss, DNS, TLS, CDN geography, or a physical phone.

| Metric, median unless stated | Standard baseline | Standard candidate | Constrained baseline | Constrained candidate |
|---|---:|---:|---:|---:|
| Largest Contentful Paint | 84 ms | 88 ms | 660 ms | 664 ms |
| Cumulative Layout Shift before input | 0 | 0 | 0 | 0 |
| DOMContentLoaded | 30.3 ms | 28.8 ms | 258.3 ms | 258.1 ms |
| Observed startup tasks over 50 ms | 0 | 0 | 0 | 0 |
| Automated wishlist click to committed frame | 84.1 ms | 82.2 ms | 99.1 ms | 99.4 ms |
| Maximum recorded Event Timing duration | 56 ms | 56 ms | 56 ms | 64 ms |

No material regression was detected under these conditions. A 4 ms LCP difference is too small to interpret as a meaningful speed change from three runs. The click-to-frame measurement includes Playwright's input delivery and synchronization overhead. Event Timing covers the observed wishlist interaction; it is **not a page-wide or field INP measurement**. These results do not establish real-user LCP, INP, or CLS compliance.

## Route and request stability

Each run loads the PDP, toggles wishlist, and returns from account to the same PDP five times. Both versions make one initial detail request and six total detail requests. This records existing refresh-on-reentry behavior; the design adds no detail calls in this exercise. No request outside the fixture allowlist, server mutation, runtime error, or CSP violation occurred.

The candidate DOM remains at 425 nodes before and after all route cycles; baseline remains at 420. Forced-GC heap growth over five cycles is approximately 232 KB standard and 229 KB constrained for both versions, with candidate/baseline median differences of 40 and 240 bytes respectively. This short paired run shows no material additional retention. It is not proof of absence of memory leaks over a long-lived session. The benchmark's request/observer instrumentation also retains data.

## Accessibility fallbacks

All focused Chromium checks passed:

- Reduced motion: product-image entrance duration is 0 seconds.
- Reduced transparency: product panel and mobile navigation have no backdrop blur; the panel uses opaque `rgb(18, 22, 28)`.
- Forced colors: the panel uses system white/black colors and retains its 1 px border without blur.
- 200% root text: the 390 px PDP has no document overflow or out-of-bounds main-content elements. This checks CSS text scaling, not every operating system's dynamic-type implementation.
- Narrow 320 px viewport: no document or main-content overflow.
- Search at 320×360: the focused field remains fully visible, from y=182.8 to 236.8 px, and Escape dismisses the dialog. This reduced-height check is a keyboard-space proxy, not an actual iOS/Android virtual keyboard test.

The broader cross-browser, RTL, light-mode, touch-target, and visual comparison evidence remains in the cinematic browser reports. These focused measurements do not substitute for that coverage or an assistive-technology audit.

## Reproduce

```sh
git show 4c019a69d3771e60b3632497092fa987d91f6309:index.html > /tmp/anox-cinematic-baseline.html
BASELINE_HTML=/tmp/anox-cinematic-baseline.html node scripts/browser-cinematic-performance.cjs
```

Use the project's installed Playwright Chromium; set `PLAYWRIGHT_BROWSERS_PATH` if the environment keeps browser binaries outside its default location. `PERFORMANCE_REPORT` optionally selects another JSON output path. No API credentials are used. The script exits nonzero for observed request/CSP/runtime failures, growing route DOM, substantial paired LCP/CLS or payload regressions, or accessibility fallback failures. Timing gates are deliberately broad to avoid treating ordinary host timing variance as a defect. Re-run after a material source change and compare the recorded source hashes.
