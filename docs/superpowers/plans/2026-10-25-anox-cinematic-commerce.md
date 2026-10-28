# Cinematic Commerce implementation sequence

The owner's detailed brief authorizes implementation. See `docs/cinematic/DESIGN.md` and `surface-map.md`; no new business decisions are required for presentation work.

1. Recover merged baseline and map actual production renderers. **Complete.**
2. Add canonical presentation tokens/style embedding with boundary/drift tests; preserve CSP and all generated client modules.
3. Recompose the live Channel3 mobile PDP first, preserving native offer/variant handlers and freshness gates. Inspect real Chromium screenshots with photo, packshot, long-title and missing-image fixtures; refine before extending.
4. Apply the proven material, spacing and hierarchy to header/mobile navigation, home, discovery/cards, cart/account/auth, request/order/policy and dialog surfaces. Keep all routes and business behavior.
5. Build an offline review with identical baseline/candidate screenshots and component states. Verify 320/375/390/430/tablet/desktop, dark/light and English/Arabic.
6. Run focused tests while implementing; full build/check/Node/Chromium/Firefox/WebKit suites at integration. Independent review challenges usability, disclosure, rendering and regressions. Record payload/performance evidence and limits.
7. Commit meaningful milestones, update continuation, publish one dedicated review PR. Do not merge/deploy.

Tests must verify behavior rather than mirror CSS strings: interaction readiness, gallery navigation, source truth, no overflow, focus/targets, selected states, fallback material, no extra network requests and canonical source integrity.
