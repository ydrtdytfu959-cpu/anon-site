# ANOX 4.0 — ASTRA MAXIMUM-QUALITY DESIGN DIRECTIVE

**Project:** `ydrtdytfu959-cpu/anon-site` · **Source:** `main` · **Date:** November 16, 2026  
**Mission:** Turn AnoX into an exceptionally refined, trustworthy, high-performance bilingual shopping experience. Deliver production-quality implementation, not a cosmetic landing-page mockup.

## 0. Operating contract for Astra (read first)

You are the principal product designer, frontend architect, accessibility engineer, and QA lead for AnoX. Use the best reasoning effort available to you, but **do not claim you can change model compute settings or guarantee aesthetic perfection**. Inspect the actual repository and all existing release, security, and design documentation before deciding what to change. If something is uncertain, label the assumption and verify it. Critique your own design as ruthlessly as an independent senior reviewer would.

**Start with the repo, not a rewrite.** The current storefront already has `Cinematic Commerce 3.0`, `Signature 2.0` icons, a canonical `cinematic.css`, a generated/CSP-hashed root `index.html`, canonical `catalog-live.js`, `auth.js`, `commerce-client.js`, and automated Node/Playwright browser tests. `index.html` currently exceeds 1 MB of raw source, so indiscriminate additions are counterproductive. Read `README.md`, `package.json`, `docs/cinematic/DESIGN.md`, `docs/cinematic/PERFORMANCE.md`, `docs/design/CINEMATIC-3-CONTINUATION.md`, and up-to-date release evidence before coding.

## 1. Product and visual north star

A premium, clean editorial storefront; distinctive **AnoX** branding, not a clone of Apple, Shopify, Nike, or any third party. Use a disciplined graphite/ivory palette, crisp restrained highlights, high-contrast typography, calibrated spacing, exquisite product hierarchy, and purposeful motion. Make *real catalog content* feel premium without masking missing product data or making commercial promises.

- Emotional qualities: confidence, ease, calm, modernity, trust, global quality.
- Visual system: charcoal `#0B0D12`, ink `#151921`, ivory `#F7F7F4`, off-white `#EDEDE9`, subtle silver borders, a measured mineral-blue accent `#7D9DEB` (not neon everywhere).
- Typography: performant system/native font stacks with well-defined Latin and Arabic rhythm; robust mixed-direction labels. Never require a paid remote font to render the store.
- Design tokens: semantic surface, text, accent, border, spacing, elevation, corner radius, typography, and timing variables; avoid arbitrary one-off values.
- 4K quality means scalable vector iconography, crisp artwork, correct intrinsic dimensions and responsive images for high-DPR displays. **Never force a 3840px bitmap to every device.** Serve `srcset`/`sizes`, modern encodings when authorized, placeholders and gracefully degraded fallback states. Do not upscale low-res retailer media or fabricate multiple product photographs.

## 2. Priority screens and flows

1. **Mobile product detail:** product image stage and galleries; image unavailable/error states; title, merchant attribution, price vs indicative quote, availability, verified selections, delivery/payment limitations; clear primary action without false checkout promises; fast and stable cart/wishlist interactions.
2. **Home/discovery:** genuinely useful hierarchy and category entrance; simple search entry; curated-feature *presentation* using real returned products and honest empty/loading states. Never invent stock or sellers.
3. **Search and results:** legible filters and sort, branded merchant information, reliable imagery and skeletons, no overwhelming card density, helpful no-results / offline / retry UI.
4. **Saved/cart and account:** coherent component patterns; reversible operations and obvious feedback; reliable RTL, keyboard, screen readers and error messages.
5. **Wide screens (1440–3840px) and compact phones (320–430px):** content max-width and typographic scale must be intentional; avoid stretched cards, excessive whitespace or horizontal overflow.

## 3. Engineering constraints — non-negotiable

- Protect catalog sourcing, official-retailer verification, auth, commerce-state semantics, server quotes, and order/service-request flows. Design changes must not silently modify the underlying business behavior.
- Checkout, payment collection, merchant purchases, carrier activation, guarantees of delivered totals and commercial approvals are **out of scope**. Render unavailable capabilities honestly; never imply an active payment flow.
- Do not touch AWS resources, quotas, API keys, Stripe settings, customer data, analytics credentials, inventory provider budgets, or production deployment.
- Preserve deterministic `npm run build` / `npm run check` and CSP hashes. Modify canonical files, not generated inline copies of canonical modules.
- Respect existing customer and analytics privacy, accessible contrast, keyboard navigation, focus management, 44px pointer targets, `prefers-reduced-motion`, `prefers-reduced-transparency`, forced colors, and logical CSS for Arabic RTL.
- No uncontrolled third-party resources, copied trademarks, fake testimonials, unverified product ratings, price reductions, shipping promises, or photos masquerading as real inventory.

## 4. Implementation phases (ship reviewable vertical slices)

### Phase A — Audit, baseline, design system

Inventory every route and existing component class; capture a baseline at 320, 390, 430, 768, 1440, 1920 and 3840 px across EN/AR and dark/light. Document real issues with before screenshots, not aesthetic guesses. Measure current image handling, responsive layout, typography/contrast, render-blocking resources, CSP, and interaction UX. Establish semantic token file or canonical section with deliberate component rules.

### Phase B — High-fidelity pilot, then real integration

Prototype homepage, search card grid, and mobile PDP as a single stylistically consistent design direction. Use isolated, clearly labeled **synthetic content** in preview only. Obtain visual feedback, then integrate into the real flows incrementally without altering commerce semantics. Keep real content server-authoritative and consider all missing data states. The accompanying `docs/ultra/preview.html` is a *concept*, not a deployed storefront.

### Phase C — Performance and responsive imagery

Address the inherited >1 MB HTML architecture prudently rather than adding another large CSS layer. Profile before proposing code splitting or cache strategy; preserve CSP, generated deterministic assets and feature tests. Use appropriate responsive media variants only when image/source rights and provider behavior allow it. Budget new dependencies: zero unless clearly justified and approved. Measure lab and physical/field conditions separately; never present fixture timing as user RUM.

### Phase D — A11y, reliability and release review

Test all routes with representative returned content, missing photos, long Arabic and English titles, source errors, old quotes, logged-out states, empty carts, 200% text scaling and 320px widths. Test pointer/keyboard/dialog dismissal and restoration. Ensure no visual fixes regress actual transactions or request counts. Generate before/after screenshots and a change log. Complete all repo `npm run build`, `npm run check`, `npm test`, and `ENGINES=chromium,firefox,webkit npm run test:browser` gates, with actual environment caveats recorded.

## 5. Definition of done

- Polished, internally consistent homepage, search/results, PDP, saved/cart and account.
- Four mandatory dimensions: **visual polish, truthful commerce UX, accessibility, and performance**. None may be sacrificed to satisfy another.
- Verified layouts and no unintended horizontal overflow at 320 / 390 / 430 / 768 / 1440 / 1920 / 3840px; EN/AR, light/dark.
- Crisp density-aware icons/media where source quality permits, no unnecessary 4K image downloads on mobile, reliable media-failure fallback.
- WCAG 2.2 AA-oriented checks (including contrast and focus); complement automated testing with manual assistive-technology review where available.
- Web Vitals targets for real-user 75th percentile where measurable: LCP <=2.5 s, INP <=200 ms, CLS <=0.1. **Unmeasured is unmeasured, not pass.** Lab tests should also compare to the repository baseline with identical fixtures.
- No unreviewed backend or commerce-state changes. No production merge/deploy without owner approval.
- Publish a draft review PR with changed file list, snapshots, exact hashes, test results, known limitations and rollback steps.

## 6. First working instruction to Astra

> Inspect `main` and the existing Cinematic Commerce system. Produce a factual visual/engineering audit and a prioritized implementation plan. Then implement the highest-impact *review-only* design slice on a fresh branch, preserving the production routes and business logic. Use the design concept in `docs/ultra/preview.html` as a visual starting point, not a specification of actual product content. Run tests, capture real before/after browser screenshots and iterate until objective issues are fixed. Do not merge or deploy; request explicit owner review. If a test cannot run, state that plainly instead of asserting it passed. Preserve the existing brand and improve, don't replace, its functional foundation.

## 7. Explicit non-goals

No fake full checkout, no forced migration to React/Next.js, no provider API experimentation without rate/cost approval, no new AWS infrastructure, no redesign that hides retailer provenance, no automatic release to Pages, no promises of 'perfect' quality without evidence.