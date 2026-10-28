# Cinematic Commerce 3.0 — independent review

Initial review 2026-10-25; correction review 2026-10-26, against merged baseline `4c019a69d3771e60b3632497092fa987d91f6309`. Correction changes were uncommitted during verification. This is a review of actual production renderers, their offline preview, CSS/build boundaries and fixture screenshots, not a production API certification. No live service requests were made. The parent owns corrections; statuses below describe the reviewed snapshot.

## Findings and verified corrections

### P1 — Offline preview direct entry can reach the production API

**Confirmed; correction independently verified.** `scripts/serve-cinematic.cjs`, `previewHtml()` and `/preview/index.html` response. The initial in-memory page retained the production API origin in `connect-src` and started the application immediately. External traffic was isolated only after a service worker controlled the page. A bookmark/direct link, unavailable worker or cleared worker registration bypassed that boundary.

Reproduction used a fresh Chromium context with `serviceWorkers: 'block'`, requested `/preview/index.html#product/channel3/cinematic-jacket`, and intercepted/aborted every external request. It recorded an attempted GET to the production product-detail endpoint while `navigator.serviceWorker.controller` was false. The existing preview test covers only the successful worker-registration entry path. No request escaped the test interceptor.

The parent added a guard around the in-memory application script requiring an active controller with this preview's exact worker URL. Independent repetition of the same blocked-worker/direct-entry case redirected to `/preview/start.html`, recorded zero external attempts and found no initialized production catalog client. This closes the reproduced issue without modifying production source addresses. Preserve direct-entry/unavailable-worker regression coverage along with the existing successful preview path.

### P2 — Retailer collections do not yet have retailer-specific orientation

**Confirmed; correction independently verified.** `index.html`, `V2CategoryHeader()` and `discoveryNavigation()`. Initial offline visits to `#shop?brand=Nike` and `#shop?brand=Sephora` retained “A world to choose from” / “ANOX / DISCOVER” and identical collection presentation. Neither retailer link carried `aria-current`; “Featured” remained current. The selected filter chip eventually identified the retailer below this heading.

The parent added `cinematicRetailer()` and `cinematicCollectionTitle()`, displaying the exact recognized retailer in an isolated `bdi`, a neutral discovery explanation and a single selected retailer link. The section navigation no longer falsely marks Featured while a retailer is selected. The source diff leaves provider calls, filtering and offer verification unchanged. This closes the reproduced orientation issue; collection imagery remains actual catalog content, not invented retailer campaigns.

Independent verification used Chromium, Firefox and WebKit at 390×844. In each engine, all six retailers were checked through both settled `shop?brand=` routes (using existing canonical brand spellings) and exact `search?q=` routes in English and Arabic: 24 retailer-route/language cases per engine. Each produced the expected heading, one correct current retailer, no current section, isolated brand text and no horizontal overflow. Four generic queries in both languages added eight cases per engine: `Nike shoes`, `Sephora makeup`, `ordinary jacket` and literal hostile-looking markup. None was mislabeled as a retailer collection; query text remained literal. **96 route cases passed across the three engines, with zero escaped requests.**

The existing brand filter is accepted only after matching loaded catalog brands; a fresh `shop?brand=` loading shell can retain its generic heading until discovery settles. This is the preserved filter contract, not a new promise of retailer availability. Exact retailer search headings are recognized without inventing loaded inventory.

### P2 — WebKit native selector touch target

**Correction independently verified.** `cinematic.css`, `select.select { height:3.25rem }`. Native select controls now have an explicit scalable height instead of relying solely on `min-height`. Independent measurement of the PDP merchant, color and size selectors returned **52px height** in Chromium, Firefox and WebKit; widths were 320px, 154px and 154px respectively. With root font size at 200% in the Arabic layout, all three selectors expanded to **104px height** in every engine. This verifies the size correction without replacing native option behavior.

## Inspected rendered evidence

Actual screenshots in `evidence/candidate/` inspected individually:

- `chromium-mobile-pdp.png`, `chromium-mobile-pdp-actions.png`, `chromium-desktop-pdp.png`: contained jacket photograph, floating mobile information panel, distinct price hierarchy, native source options, clear add/save disclosure.
- `chromium-mobile-pdp-beauty.png`, `chromium-mobile-pdp-missing.png`: non-fashion aspect ratio and honest missing-image/unknown-price treatment.
- `chromium-mobile-pdp-light.png`, `chromium-mobile-pdp-rtl-full.png`: light and mirrored Arabic compositions. The reviewed RTL screenshot predates the new isolated gallery counter; current source adds `<bdi dir="ltr">` to correct its reversed numeral order.
- `chromium-mobile-home.png`, `chromium-desktop-home.png`, `chromium-mobile-shop-grid.png`: editorial hero and shared discovery card hierarchy; fixture merchandise remains illustrative.
- `chromium-mobile-cart-full.png`, `chromium-mobile-signin.png`, `chromium-mobile-assistant.png`: truthful saved-selection/checkout state, visible auth focus and mobile conversation layout.
- Correction review: `chromium-mobile-retailer-nike.png` and `chromium-mobile-retailer-nike-rtl.png` show the new collection heading and selected retailer in English and Arabic. Both were inspected at their actual rendered dimensions.

The single-image beauty screenshot also predates the now-disabled previous/next controls. Regenerate affected final evidence after corrections rather than representing these older screenshots as the exact final head.

## Focused browser checks

Read-only Chromium checks used the isolated preview with external interception. Main PDP primary action, wishlist, variant selector and disclosure summary passed Playwright actionability trials at 320×780, 390×844, 768×1024, 1440×960 and 844×390. All five had zero document horizontal overflow. At 320 pixels with root text size increased to 200%, document scroll width remained 320; only the intentionally offscreen skip link appeared in a raw bounds scan.

Mobile navigation overlaps content in viewport and full-page captures because it is fixed. This alone is not an inaccessible-control defect: the actionability checks scrolled the real controls into clear view. Short landscape does require substantial vertical scrolling between the large photo and gallery controls; a reduced sticky treatment at short heights would improve composition, but no inaccessible target was demonstrated.

## Source review results and limits

- No lost business disclaimer, unescaped provider-text interpolation, malformed PDP nesting or weakened detail/offer readiness condition was found in the reviewed markup diff. The new section wrapper closes before source disclosures. Existing variant, gallery, cart, wishlist and retry hooks remain in place.
- Saved wishlist art reuses already-held product/cart presentation data; it does not introduce new detail hydration. Source validation remains in the canonical catalog/cart modules.
- Canonical cinematic CSS embedding follows the existing boundary/rebuild/CSP mechanism. No production provider, authentication or commerce state-machine edits were present in the reviewed diff.
- Current screenshots demonstrate mobile/desktop visual composition, not complete WCAG conformance. The parent's full functional/cross-browser and contrast/fallback checks remain necessary.
- The initial `evidence/candidate/report.json` omitted navigation timings and reported `resourceCount: 0` under the installed browser clock; its CLS accumulator spanned multiple interactions/routes. These screenshot-harness values must not be used as performance proof. The parent subsequently added a separate unmocked-clock `browser-cinematic-performance.cjs` and `evidence/performance.json`. Reviewed report metadata records 12 isolated Chromium laboratory runs, standard/constrained profiles and no reported failures/warnings, with explicit exclusions for production, real-user Core Web Vitals and actual mobile/Safari performance. I inspected that scope and report summary but did not independently rerun the performance harness; its results remain the parent's separate laboratory evidence.

No merge or deployment is authorized by this review. The reproduced preview isolation and retailer orientation findings are closed, and the WebKit selector-size correction is independently verified. Final readiness still requires refreshed affected evidence and the integration owner's full verification results; this focused review is not a substitute for those gates.

## Integration follow-through (parent, 2026-10-26)

After the independent checks, affected screenshots were regenerated on the final HTML hash recorded in VALIDATION.md, then inspected. The full integration gate and expanded responsive matrix passed. Original review comments above describe the evidence available at their review time; final reports now reference the corrected source.
