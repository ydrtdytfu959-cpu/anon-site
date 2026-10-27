# AnoX Cinematic Commerce 3.0

Owner brief: 2026-10-25. Implementation baseline: merged PR #28, `4c019a69d3771e60b3632497092fa987d91f6309`. Dedicated branch: `design/anox-cinematic-commerce-20261025`. This is a review candidate; merge and deployment require separate approval.

## Design decision

Build a graphite studio around the existing storefront: spacious product imagery, precisely grouped selection controls and a softly illuminated purchase panel. Original AnoX branding and the Signature icon family remain intact. The reference informs composition and restraint, not imagery, names or commercial claims. No framework or runtime dependency is added.

The flagship mobile PDP leads. A stable, contained image well preserves every source photograph; a floating information panel joins imagery to selection. Brand, title, current price, actual availability, merchant offer and freshness form a clear hierarchy. Unknown values stay unknown. Native variant selection remains authoritative. Source descriptions and disclosures sit below the primary action. Missing imagery receives a deliberate empty state.

## Foundations

- Near-black canvas; graphite surfaces; silver edges; off-white primary text; muted blue focus and selected accents. Light mode uses pearl and graphite rather than inverted photography.
- Existing system fonts; compact editorial headings, readable 16px form controls, logical spacing and Arabic line-height adjustments.
- Glass limited to navigation, selected controls and the PDP panel. Other information surfaces are opaque. Blur has an opaque fallback, reduced-transparency and forced-color handling.
- Main actions remain in document flow. 44px minimum targets, keyboard focus, safe-area clearance and reduced-motion support are release requirements.
- Canonical `cinematic.css` embeds through the existing deterministic build and CSP pipeline. Controller, catalog, auth, cart and backend logic are not replaced.

## Acceptance

Actual offline browser renders, matching before/after dimensions, desktop/mobile/light/RTL and failure states. Photography in the review is explicitly synthetic fixture data and never enters the production catalog. Measure payload and laboratory layout/interaction behavior separately from unmeasured real-user Core Web Vitals. Full existing regression coverage remains required before candidate completion.
