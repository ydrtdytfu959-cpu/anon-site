# Cinematic Commerce 3.0 — customer surface map

Discovery snapshot: 2026-10-25, branch `design/anox-cinematic-commerce-20261025`, baseline `4c019a69d3771e60b3632497092fa987d91f6309` (merged hardening). This map records the baseline implementation, not validation of a redesigned candidate. No provider, AWS, account or payment operations were performed for this discovery.

## Source of truth

The production page is `index.html`: shell markup, screen renderers, routing, controller and most presentation CSS are canonical there. Four JavaScript modules are canonical separately: `catalog-live.js`, `auth.js`, `commerce-client.js`, and `icons.js`. `icons.css` is also canonical separately. `scripts/build-clients.cjs` embeds these sources into the HTML; `scripts/build-catalog.cjs` computes the CSP hash for the single inline script. Edit canonical modules, never their generated inline copies. Adding a separate cinematic CSS source requires explicit builder support with checked boundaries, followed by `npm run build` and `npm run check`.

`beta/index.html` is an independent noindex legacy demonstration, not the production source or generated copy. Production has a `?debug=1` developer mode; several familiar-looking checkout, account, PDP and request renderers are reachable only in that mode. Use normal production mode for design acceptance.

The stylesheet contains multiple generations of rules. The current `.v2-*`, `.anox-*`, `.commerce-*` hooks and canonical `icons.css` are more useful than old generic selectors alone. Avoid editing obsolete rules and assuming the current screen changed.

## Customer screen matrix

Function names are stable search anchors; line numbers will change during implementation.

| Surface / route | Production renderer and shared hooks | Behavior that must remain intact |
| --- | --- | --- |
| Global header, categories, mobile navigation | `updateShell`, `V2MobileCategories`, `menuMarkup`; `.v2-site-header`, `.v2-header-main`, `.v2-header-search`, `.v2-header-action`, `.v2-category-band`, `.mobile-nav` | Localized labels, cart count from production selection cart, `aria-current`, existing deep links, keyboard mega-menu behavior, brand SVG. Authentication uses a separate shell. |
| Home `#home` | `renderHome`; `.anox-home-hero`, `.anox-home-intro`, `.anox-home-shell`, `.anox-home-categories`, `.anox-home-grid` | Real catalog records only; loading/unavailable/empty states and retailer-neutral copy. Do not make decorative hero rendering trigger extra detail lookups. |
| Shop/category `#shop?...`, new arrivals `#new` | `renderShop`, `renderNew`, `V2CatalogPage`, `V2CategoryHeader`, `catalogResults`; `.v2-catalog-page`, `.v2-category-heading`, `.v2-catalog-layout`, `.v2-filter-panel`, `.product-grid` | URL filter state, cursor context/restart, pagination, bounded existing discovery calls, preserved presentation-only records. |
| Search `#search?q=...` and search dialog | `renderSearch`, `openSearch`, `renderSuggestions`; `.v2-search`, `.v2-search-input-row`, `.v2-suggestion` | Combobox/listbox semantics, arrow/Enter navigation, query URL, link-to-request path, request epoch/debounce behavior. |
| Retailer/brand collection `#brands` and `#shop?brand=...` | `renderCollections`, `discoveryNavigation`, shared catalog renderers | Six approved retailer links already exist, but retailer and product-brand concepts differ. Collection art direction can vary by verified route identity; no endorsement claim. Do not turn the set of loaded product brands into a provider-coverage guarantee. |
| Catalog product card | `productCard`, `productArt`, `V2Price`, `liveProductMeta`, `liveProductLink`; `.v2-product-card`, `-visual`, `-image`, `-info`, `-brand`, `-name`, `.v2-product-wishlist` | Escaped source text; safe URLs; source evidence and freshness; button `aria-pressed`; `data-product`, `data-wishlist`. Presentation-only cards do not have a verified price. |
| Channel3 PDP `#product/channel3/{id}` (flagship) | `renderChannel3Product` → `renderDetailContent`, `detailGalleryMarkup`; `.v2-product-detail`, `.v2-product-gallery.commerce-gallery`, `.v2-product-information`, `.commerce-option`, `.v2-pdp-actions` | Fresh detail, offer identity, options and cart readiness described below. This is the production flagship, not the legacy `renderProduct` renderer. |
| CJ-origin PDP `#product/channel3/cj-nike-{id}` | `renderCjNikeProduct`; same `.v2-product-detail`, `.v2-product-gallery`, `.v2-product-information` | Presentation-only official Nike record; optional source image/description and external official link. No invented price, variants, availability or cart action. |
| Other/legacy supported product links `#product/{slug}` | `renderProduct`, `V2ProductGallery`, `V2ProductInfo` | Preserve supported deep links and unavailable-product handling. Demo products must not appear in normal production mode. |
| Wishlist `#wishlist` | `renderLiveWishlist`; `pageShell`, `.stack`, `.surface`, existing product grid | Channel3 entries can have only saved ID and title; no automatic metered detail hydration. CJ legacy IDs have bounded canonical recovery. Preserve removal, retry and durable saved choices. |
| Cart and `#checkout` | `renderSelectionCart`, `selectionLinesMarkup`, `commerceCostMarkup`, `serviceRequestMarkup`; `.commerce-cart-layout`, `.commerce-cart-line`, `.commerce-cost`, `.surface`, `.stack` | Cart selections are not orders. Quantities, optimistic edit identity, quote revision/expiry, refresh, errors, disabled payment and explicit service-request creation remain unchanged. `#checkout` intentionally renders this same protected screen. |
| Sign in/up and recovery | `renderProductionAuth`, `renderAuthShell`; `.anox-auth`, `.anox-auth-header`, `.field`, `.anox-auth-password` | Native labeled forms, `data-anox-auth`, no credential draft persistence, email/password/confirm/recover/reset steps, busy guards, validation focus and auth epochs. |
| Account `#account` | `renderProductionAccount`; `pageShell`, `.anox-policy`, `.anox-policy-section`, `.order-card` | Signed-in/out, loading and error states; user/server records only; sign-out; browser-data clearing distinct from account deletion. |
| Orders and tracking `#orders`, `#order?id=...`, `#track?...` | `renderOwnedOrders`; `.surface`, `.spec-list`, `.stack` | Authenticated server state; account/session epoch checks; cursor validation; missing-record/error handling. No invented shipping timeline or inferred payment success. |
| Product/business inquiry | `renderPublicInquiry`; `.anox-policy`, `.anox-policy-section` | Existing email-based inquiry; do not replace it with a simulated working order form. |
| Unsupported old request/quote/settings routes | `renderCommerceBoundary`; `pageShell`, `.anox-policy` | Clear current capability boundaries and contact path. Developer-mode forms are not production ordering features. |
| Privacy, terms, about, contact, affiliate, shipping, returns, partners, help | `renderPublicPage`; `.anox-policy`, `.anox-policy-section` | Existing policy text, links and analytics-consent controls. Styling is safe; claims must remain accurate. |
| Assistant dialog | `openAnoX`, conversation markup; `.anox-conversation`, `.anox-conversation-log`, `.anox-conversation-footer` | Log/live-status semantics, input bounds, pending/error/retry handling, limited backend requests and mobile keyboard clearance. |
| Shared dialogs, toast and unavailable states | `openDialog`, `closeDialog`, `emptyMarkup`, `pageShell`, `liveCatalogStateMessage`; `.dialog`, `.dialog-head`, `.dialog-content`, `.scrim`, `.empty`, `.notice`, `.toasts` | Focus trapping/restoration, background inertness, Escape, accessible status/alert roles and precise error meaning. |

## Flagship PDP contract

- `detailView` is an internal state machine. Restyling must preserve `renderChannel3Product` request identity, abort handling and `leaveProductDetail`. Hardening fixed rejected-option and stale-cart-edit navigation so returning restarts the aborted detail request.
- `detailOffer()` selects by merchant domain **and condition**, requiring unambiguous matching offers. Product `brands` are not merchant attribution. Keep the actual merchant/offer selector and source disclosure visible in the new composition.
- The visible price must remain conditional on fresh detail, USD and a non-null source price. Expired/presentation-only detail shows unknown price and availability, a freshness explanation and refresh action. Never fill a missing value from artwork or fixture copy.
- `detailSelectionReady()` controls add-to-cart: current detail, fresh timestamp, selected offer, applicable price, availability, no mismatch and verified option identity. Unknown availability is accurately disclosed; the UI must not replace it with “in stock.” Stock quantity is explicitly unavailable.
- The native `select[data-commerce-option]` is the current canonical interaction. Its `change` handler navigates using all effective options, merchant, condition, edit revision and line. An option may refer to a different product ID. A blank choice restores the verified visible selection. If visual pills are added, retain an accessible source-of-truth select or equivalent native control and route through this same contract rather than mutating `detailView` or synthesizing availability.
- Keep `data-commerce-merchant`, `data-commerce-quantity`, `data-commerce-add`, `data-commerce-wishlist`, `data-commerce-accept-options` and retry hooks. Their existing delegated handlers enforce these invariants and preserve selection/edit behavior.
- Gallery changes rerender the current detail markup, restore scroll position and focus. Preserve `data-commerce-gallery`, `data-commerce-swipe`, keyboard arrows/Home/End, thumbnail `aria-pressed`, bounded swipe recognition and lazy thumbnails. Do not start product/detail network requests for gallery motion or theme changes.
- Failed `data-commerce-image` elements are replaced with `.commerce-image-empty` text. A missing-image composition must look intentional without fabricated merchandise. Use contained imagery and stable aspect ratios for product photographs; never assume an arbitrary source image can be cropped as a lifestyle image.
- Source descriptions, titles, key features and attributes are escaped with `esc()`. Do not inject provider HTML while adding editorial layouts.
- “Add to cart” saves local choices, not inventory or purchase authorization. Preserve the adjacent disclosure; do not hide it to make the panel fit.

## Safe presentation foundations

Use the existing semantics and add presentation wrappers/classes around them. Shared primitives are `.btn`, `.icon-btn`, `.input`, `.select`, `.textarea`, `.field`, `.surface`, `.notice`, `.spec-list`, `.actions`, `.stack`, `.page-heading` and `pageShell`. New cinematic tokens should map to these surfaces instead of replacing their behavior. Keep icon control states in `icons.css` compatible with the new material palette.

Shared `.v2-product-detail`/gallery/information classes cover Channel3, CJ and legacy product paths. Add explicit variant classes for immersive/fallback layouts when needed instead of assuming every product has options or a priced offer. Place the CTA in normal document order even if a sticky presentation enhancement is used, and account for the existing bottom navigation and safe area.

No Lady Mode implementation was found in the canonical application or repository search. Current supported variations are `html[data-theme="dark"|"light"]` and `html[dir="rtl"|"ltr"]`, set by `updateShell` with persisted `state.theme` and `state.lang`. Do not invent a parallel Lady Mode state machine under a preservation requirement.

`tx(ar,en)` and `localized()` supply interface text. Use logical layout properties and retain `bdi` for prices, domains, emails and identifiers. Arabic headings already remove Latin letter-spacing and use distinct line height/font fallback. Check text expansion and control ordering, not just alignment. `setLanguage` preserves active search/menu/filter/assistant behavior; theme switching must not fetch new catalog data.

## Existing verification to preserve and extend

- `scripts/browser-commerce.cjs` exercises the actual shipped HTML/CSP with intercepted detail/auth/commerce fixtures: gallery, variant refresh, invalid/mismatched/ambiguous/stale products, missing imagery, cart editing, quote and service-request gates, account isolation, phone/desktop layouts.
- `scripts/browser-hardening.cjs` explicitly checks the rejected-option and stale-edit recovery cases plus hostile source text and blank option restoration. Its assertions must continue passing after markup changes.
- `scripts/browser-catalog.cjs` owns strict retailer filtering and catalog failure/pagination behaviors; do not reimplement these contracts for visuals.
- `scripts/browser-icons.cjs` checks named icon controls, 44px targets, selected states, focus, RTL, themes, reduced motion and viewports. `scripts/browser-icon-preview.cjs` checks the older icon review page; it is not sufficient evidence for cinematic screen quality.
- Node tests cover the canonical client embedding/CSP, auth, catalog, cart, business boundaries and hardening. Run the required full suite at integration gates; use focused browser runs during visual iterations.
- New visual fixtures must be identified as synthetic review data. Capture actual normal-mode renderers and matching baseline dimensions. No metered production request is required to validate a presentation-only redesign.

## Known visual integration gaps, not new backend defects

1. Existing Channel3 wishlist rows intentionally store little presentation data; a rich layout must tolerate title/ID-only records without extra metered calls or invented prices.
2. Six retailer navigation entries share a catalog renderer; any differentiated art direction should be driven by the already-validated route identity, preserving provider filtering.
3. Existing production PDP uses native selects rather than color/size pills. An enhanced selector must support arbitrary source option names/labels, not just apparel sizes or color names convertible to CSS colors.
4. Availability/freshness/source statements are numerous because they describe real constraints. Improve hierarchy through grouping and disclosures, but keep current critical price/availability and selection warnings readily visible.
5. The authentication shell removes normal navigation. It needs separate visual verification so global header work does not leave sign-in on the old system.

This map is architectural evidence only. Candidate screenshots, measured payload/performance changes, cross-browser results and independent visual critique belong to the implementation checkpoint and review package.
