# AnoX icon system

This update refines interface iconography and selected icon controls. The AnoX wordmark, favicon, layout, typography, product imagery and business behavior remain outside the change. The design uses original SVG geometry; it does not contain Apple SF Symbols or require an icon font, external asset host or additional runtime dependency.

## Visual contract

- Draw on a 24 × 24 grid with a 1.75-unit rounded stroke. Keep geometry optically centered with clear interior spaces; compare perceived weight at actual rendered sizes, not only at enlarged scale.
- Use `currentColor` so the control supplies the appropriate theme, hover, disabled and selected colors. Default display size is 22px; the size scale is 16, 20, 24 and 32px for compact indicators, controls and feature markers.
- Keep a minimum 44 × 44px interactive target. Icon size and touch area are separate measurements. Retain surrounding text where it helps identification, particularly categories, navigation, orders and tracking.
- Limit glass treatment to selected icon containers and interactive controls: a translucent surface, restrained highlight, a light border and shallow shadow. Content panels and product imagery are not glass surfaces. Retain a solid fallback without backdrop filtering.
- Category glyphs share the same grid and stroke while describing eight different subjects: clothing, shoes, technology, beauty, accessories, home, sport and lifestyle. Color is supplementary and never the only identifier.
- Keyboard focus must remain visible. Every icon-only control keeps its localized accessible name and native button/link behavior. Decorative SVGs use `aria-hidden="true"` and `focusable="false"`; selection and disclosure state remain on their controls.
- Directional controls follow the existing Arabic/English direction behavior. Reduced motion disables transitions; forced-color modes must retain clear boundaries and selected/focus indications.

The canonical JavaScript registry is `icons.js`; the presentation tokens and control styling are in `icons.css`. `AnoXIcons.render(name, extra)` emits self-contained decorative SVG markup. Unknown names, including inherited object properties, resolve to the information glyph. Extra class names are sanitized. Consumers must continue to use labeled controls rather than treating the SVG as an accessible button by itself.

The original icon artwork, renderer and icon-specific styles are commercially usable under the MIT license in `LICENSE-icons.txt`. Preserve its copyright and permission notice when redistributing these assets. This license does not apply to the AnoX logo or unrelated repository assets. The companion license is the authoritative license text.

## Baseline audit

The production baseline contained 24 glyphs in one `ICONS` registry, 46 render invocations, and three separately authored assistant SVG templates. The registry used a 24-unit grid and 1.65 stroke; the assistant templates mixed 20/24-unit grids and 1.3/1.5/1.7 strokes. There were no external icon packages, fonts or emoji-based interface icons.

The following references describe the production baseline before icon integration; subsequent edits can move line numbers. Function and selector names remain useful search anchors.

| Surface | Baseline source in `index.html` | Audit finding |
| --- | --- | --- |
| Shared SVG renderer | Lines 2867–2895, `ICONS`, `icon()` | 24 glyphs; centralized coverage makes a presentation-only migration possible. |
| Header and mobile navigation | Lines 6063–6066, `updateShell()` | Search, account, cart, menu, home and shop symbols; preserve badge and current-page state. |
| Assistant | Lines 4010, 4028–4029 | Chat, suggestion-plus and send-arrow were outside the registry. The trigger's label was only “AnoX.” |
| Dialogs and comparison | Lines 4116, 4447, 4455 | Close symbol plus typographic ✓/+ comparison state. |
| Filters | Lines 5809–5820, `filterChips()`, `catalogResults()` | Registry filter; chip removal used typographic ×. |
| Category navigation | Lines 6001, 6071–6076, 6327, 6341, 6409 | Mostly text-only; category search suggestions all reused the same shopping bag. |
| Favorites and product actions | Lines 6082, 6092, 6105, 6404, 6666 | Heart, zoom and quantity icons; preserve `aria-pressed`, product IDs and action selectors. |
| Cart | Lines 4479, 6675–6734 | Legacy quantity glyphs; production cart edit/remove actions are text-labeled. |
| Gallery and pagination | Lines 4307–4319, 6649–6652 | Text previous/next controls and image thumbnails. Do not remove explanatory labels merely to add icons. |
| Account and authentication | Lines 4704, 4803–4813, 6455–6467 | Theme icon plus text account/password controls. |
| Orders and tracking | Lines 4621–4626, 4815–4824, 6689–6711 | Legacy timeline check/info glyphs; current server-recorded states are text-based. Icon decoration must not suggest shipping/payment capabilities. |
| Notifications and empty states | Lines 3952, 4230, 6216 | Check/warning/info and configurable empty-state glyph. |

Other icon-like presentation included the border-built category caret (`.v2-caret`, baseline lines 848–849), mobile disclosure +/− pseudo-elements (875–876), selected swatch checkmark (900), timeline circles (293–295), and filter-chip ×. These need visual consistency but no change to their state machines.

The baseline theme utility button was 30 × 30px and mobile header actions could be 40px wide. These controls require 44px touch areas. Existing reduced-motion rules, focus outlines, disclosure semantics, wishlist toggle state and RTL arrows provide behavior to preserve.

## Scope boundaries and evidence

The wordmark (`V2_WORDMARK` and boot logo), `favicon.svg`, and generated product illustrations are distinct assets and are not replaced. `beta/index.html` is a separate, noindex offline legacy demo: it has its own 24-symbol registry and 42 invocations. It is inventoried here but excluded from the production storefront icon update; it is not a redirect or an automatically synchronized copy.

The Node regression tests in `tests/icon-system.cjs` validate the safe SVG boundary, accessible decorative markup, category completeness, unknown-name behavior, prototype-property handling and malicious class input. These tests deliberately do not snapshot every path string: visual quality, optical alignment, contrast, clipping and actual interaction states require browser review.

Browser evidence must cover desktop and mobile, both languages/directions, both themes, reduced motion, keyboard focus, open/closed disclosures, selected/unselected favorites, search, product details, cart, account and order/tracking presentation. Screenshots should include the same baseline and candidate routes/viewports for a useful before-and-after comparison. Mocked catalog/account fixtures are appropriate for this visual task and must be identified as fixtures; visual evidence does not certify provider inventory or live commercial operations. No metered production API test is necessary for an icon-only change.

Inline JavaScript changes require rebuilding the checked-in HTML and its CSP hashes through the existing build pipeline. The production script boundary, catalog providers, commerce data, AWS configuration, fee rules and disabled payment behavior remain unchanged. Test execution results and screenshot paths belong in the final review evidence; this design document does not itself assert that checks have passed.
