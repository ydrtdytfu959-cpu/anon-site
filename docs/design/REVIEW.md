# AnoX Signature 2.0 — owner review

PR #27 continues the original icon branch. This second refinement makes the frequently used controls more visible through directional edge lighting, clearer selected surfaces and stronger category silhouettes. It preserves the existing storefront architecture, logo, typography, product content and business behavior.

## Inspect the change

Open `http://127.0.0.1:8786/docs/design/preview.html` while serving the repository with `python3 -m http.server 8786 --bind 127.0.0.1`. Open that review path directly; the ordinary storefront root retains production API configuration. The review's CSP blocks API connections.

The [interactive review](preview.html) starts with matched component crops at normal size or explicit 200% magnification. Select either **First refinement** or **Released baseline**. It also preserves the slider for 15 screens×4 viewports, the 35-glyph atlas at 16/20/24/32 px, and interactive hover/focus/saved/disabled examples. All screenshots use offline synthetic accounts, orders and labeled sample art; they are not live-provider evidence.

| Control | First refinement | Signature 2.0 |
| --- | --- | --- |
| Desktop header | [Before](evidence/focus/v1/chromium-desktop-header-controls.png) | [After](evidence/focus/after/chromium-desktop-header-controls.png) |
| Mobile header | [Before](evidence/focus/v1/chromium-mobile-header-controls.png) | [After](evidence/focus/after/chromium-mobile-header-controls.png) |
| Active mobile navigation | [Before](evidence/focus/v1/chromium-mobile-navigation.png) | [After](evidence/focus/after/chromium-mobile-navigation.png) |
| Search categories | [Before](evidence/focus/v1/chromium-desktop-category-controls.png) | [After](evidence/focus/after/chromium-desktop-category-controls.png) |
| Saved heart | [Before](evidence/focus/v1/chromium-desktop-wishlist-selected.png) | [After](evidence/focus/after/chromium-desktop-wishlist-selected.png) |
| Light mobile header | [Before](evidence/focus/v1/chromium-mobile-header-controls-light.png) | [After](evidence/focus/after/chromium-mobile-header-controls-light.png) |

Full examples: [desktop search](evidence/after/firefox-desktop-search.png), [320 px expanded menu](evidence/after/firefox-narrow-menu-expanded.png), [tablet Arabic layout](evidence/after/firefox-tablet-home-rtl.png), [mobile selected heart](evidence/after/firefox-mobile-shop-saved.png). The original production evidence remains in `evidence/before`; the entire first-refinement evidence is retained in `evidence/v1`.

## Substantive refinements

- Header containers grow from 34 px to 38 px inside existing accessible controls. A directional top edge, restrained side light and recessed lower edge replace the flatter first-version surface. Assistant, account and cart remain visually grouped; the assistant has a stronger rim. Mobile icons align at the top of the action group despite different label visibility.
- The mobile active destination gains a framed background spanning its existing tab, without increasing the navigation footprint. The selected glyph has slightly greater visual weight. Other tab symbols remain flat.
- Floating wishlist controls become circular. Saved hearts use a light porcelain surface with a dark filled glyph, distinct from the dark resting control. Shape and fill preserve meaning without color alone. The existing 8 px blur remains limited to these 44 px overlays.
- Category symbols gain quiet inset tiles in search and menus; primary category navigation stays flat. Four original glyphs were refined: a more open shirt collar, a taller shoe upper, an angled lipstick silhouette replacing the generic bottle, and wider negative space in the sports symbol. The other 31 glyphs were retained after atlas inspection.
- Hover adds a small lift and stronger edge; press adds an inset response and glyph compression. A first experiment scaled the whole 44 px target below the minimum. The browser test caught this, and the implementation now preserves the full target while scaling only its glyph. Reduced-motion mode removes movement and transitions.
- Gallery selection receives a visible outer boundary. Text-led add-to-cart, filtering, comparison and service actions retain their established labels and behavior; glass is not applied to every element.

These are original web assets, with the existing [MIT license](../../LICENSE-icons.txt). No Apple symbols, external icon services, frameworks or runtime dependencies were added. The design applies the control/content distinction described in [Apple's materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials); it does not reproduce Apple's material renderer.

## Visual judgment and accessibility

Primary review inspected real Chromium/Firefox renders at 1440, 768, 390 and 320 px, desktop wrapping boundaries, light/dark themes, Arabic/RTL, keyboard focus, pressed/selected states, menus and both glyph atlases. The most perceptible improvements at normal scale are the saved-heart surface, active mobile tab, category tiles and header edges. This is a design judgment supported by the linked comparisons, not an objective claim of perfection.

No remaining material alignment, clipping, contrast or responsive defect was identified in those views. The first version had independent visual review. Independent Signature 2.0 review was attempted, but all three subagents reached usage limits before completing their assigned refinement/critique; do not interpret the primary review as independent second-version signoff.

Enabled heart/send contrast has a conservative tested minimum of **6.51:1**, using computed gradient stops and both black/white substrate extremes. Icon-control targets remain at least 44 px, including press captures. Keyboard dialog dismissal, restored focus, category expansion, filter removal, gallery navigation and wishlist state remain verified. Forced colors preserve a filled selected heart and control boundary. Chromium's reduced-transparency emulation verifies an opaque selected surface with blur removed; Firefox's selected/forced-color behavior is tested, but reduced-transparency emulation is not available through this harness.

The glyph family remains 35 original symbols on a 24-point grid, normally 1.75 stroke. The selected mobile-nav glyph uses 2-unit visual weight. All glyphs retain decorative `aria-hidden`/`focusable` semantics. This is focused control verification, not a whole-site WCAG certification.

## Verification

Local tooling: Node 24.18.0, npm 11.16.0, Playwright 1.63.0, Chromium 153.0.8010.12, Firefox 155.0.

- `npm run build` and `npm run check`: passed; canonical CSS/JS and CSP hashes remain deterministic.
- `npm test`: **386/386 passed**, with zero failures or skips.
- Icon browser suite: **360 checks across eight engine/viewport runs**. The original 348 checks remain;8 selected-state forced-color checks and 4 Chromium reduced-transparency checks were added. Reduced-motion checks now cover control containers as well as SVGs. No unexpected network requests, customer writes, runtime errors, CSP violations or document overflow.
- Review browser suite: **120 full comparisons and 40 matched close-up/scale checks per engine**, plus slider endpoints, 35 glyphs, saved/disabled/theme states and four viewport layouts. Counts increased because both production and first-refinement baselines are selectable, with ten component pairs at two scales.
- The existing 72 catalog/commerce browser groups also passed in the final combined command. Full local validation completed successfully. PR-head CI status is recorded in the PR checks and publication receipt.

[Final capture report](evidence/after-report.json):360 checks and 258 full captures. The committed review contains 246 PNGs:68 production, 74 first-refinement, 74 current full captures, and 30 matched crops. The [first-refinement report](evidence/v1-report.json) is retained. Reproduce final captures with `SCREENSHOT_DIR=/absolute/output ENGINES=chromium,firefox node scripts/browser-icons.cjs`. Focus crops are generated directly by the browser under `focus/`, never synthesized or retouched.

## Performance and scope

| Canonical HTML | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Production baseline | 1,081,336 | 428,002 |
| First refinement | 1,090,281 | 429,835 |
| Signature 2.0 | 1,094,085 | 430,401 |

The second pass adds **566 gzip bytes (0.13%)** over the first refinement; total growth from production is 2,399 bytes (0.56%). Final HTML SHA-256: `a2249d95b5bba32dc42d3dba6e1819e4ecd9731f9cc01aa57a2e74d0b895bca1`. Review screenshots are not storefront runtime loads.

A sequential Chromium CPU microbenchmark compared 100 selected-state changes with computed-style flush, one warmup and five measured batches. Median style recalculation was 0.988 ms before and 0.924 ms after; median task time was 1.279 ms and 1.211 ms. Both recorded zero layouts. These small differences are within ordinary lab variation; they support no observed increase in this workload, not a speedup claim. [Raw data and method](evidence/signature-performance.json) are retained. Set `PERFORMANCE=1 REPORT_PATH=/absolute/report.json ENGINES=chromium VIEWPORTS=desktop` when running the harness against each HTML version to reproduce.

No persistent animation, animated filter or additional blur surface was introduced. Physical mobile-device GPU/frame-rate testing remains unmeasured. The chosen material has an opaque fallback, with reduced-transparency and forced-color alternatives.

The diff remains empty for backend, provider, authentication, commerce, analytics, favicon and legacy beta sources. The index changes are the generated icon CSS/JS and corresponding CSP hash. No provider calls, AWS operations, budget changes, payment activation, customer writes, merge or deployment occurred. PR #27 remains for owner design review; production release requires separate approval.
