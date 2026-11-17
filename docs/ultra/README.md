# AnoX 4.0 — review-only concept

This directory contains a **standalone visual design study**, not a replacement for the storefront, not production catalog data, and not an authorized checkout. `preview.html` can be opened on GitHub Pages after the review branch is published, or served locally on a static server. It has no external dependencies or API calls.

- [Design preview](preview.html): desktop/mobile concept with illustrated synthetic objects, product-preview modals, demo search, favorite state, light/dark palette and English/Arabic RTL controls.
- [Astra master implementation directive](ASTRA_MASTER_BRIEF.md): comprehensive engineering/design requirements and phased execution plan for the real AnoX app.
- [Validation and limits](VALIDATION.md): what was tested (and, crucially, what was not).

This study deliberately leaves `index.html`, `cinematic.css`, canonical app modules, CSP build pipeline, all business logic, backend, AWS and production deployment **untouched**. The real-app design should evolve through separately reviewed and tested PRs.