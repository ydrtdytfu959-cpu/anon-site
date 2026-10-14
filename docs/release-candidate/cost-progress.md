# Cost/cache work checkpoint

Completed local cost worker handoff October 14, 2026. Baseline `dd11ddedf277d74446d77af6836a67ee30abebf7`, branch `feat/anox-commerce-foundation`; all current changes remain uncommitted under root ownership. No cloud mutation, secret value read, provider calls, paid allocation or deployment.

## Completed

- Official pages re-read October 13: https://docs.trychannel3.com/guides/caching ; https://docs.trychannel3.com/pricing ; https://docs.trychannel3.com/faq/rate-limits . Public list terms verified; account plan/balance/invoice remain unknown.
- COST-03 source correction: backend search cache strips all offers/price/stock/variants; catalog adapter ignores old backend volatile data and emits strict presentation-only records. Core nullable price/stock and empty variants are allowed only for that Channel3 form. UI shows price-on-detail guidance, no cached retailer links, no unsupported filter/sort controls or misleading deals navigation. Legacy price-filter URLs disclose limitation and recover with clear filters. One-image/media budget and cursor flow retained.
- Cache schema 2 excludes old full-card pages and rejects old cursor context explicitly. Spending counter identities unchanged. Paired frontend/backend compatibility and safe rollback constraints documented.
- Staging metric namespace isolated with explicit allowlist. Invalid namespace returns503 without AWS calls, logs or provider access.
- Offline reproducible best/base/stress demand model for100/1,000/10,000MAU, separate free/paid/detail accounting and AWS assumptions/exclusions. No configuration changes enabled.
- Scoped legacy-secret denial artifact and migration/drain/reconciliation proposal prepared, not applied. Actual all-consumer/account isolation remains a release gate.
- Final cost/cache and consumer proposal reports written. Root owns final combined issue register and AWS inventory refresh.

## Tests and evidence

- Three presentation backend/adapter/core tests observed red before correction, then green. Browser honest-price assertion observed red, then green. Staging EMF namespace assertion observed red, then green.
- 66 focused catalog/cache/adapter/repository/runtime tests passed, zero failures/skips, before two additional acceptance tests.
- Chromium+Firefox catalog20/20groups including135embedded self-tests per engine passed; `catalog-browser-results.txt` retains raw fixture output.
-42/42final backend/cache/runtime/cost-model tests passed, zero failures/skips (includes added old-policy cursor and invalid metric environment cases).
- Initial full concurrent npm test254/257pass had3generatedparity failures while root/other workers were still editing: client bundle, commerce template, exporter rebuild. Root will run official final build and final complete validation; no failure exempted.
- Native browser launch first failed sandbox macOS ports. An escalation was later accepted; one intermediate retry hit automatic review usage limit and did not execute. Resumed two-engine run succeeded with accepted escalation. No remaining approval-tool blocker for this evidence.

## Files owned / handed off

`backend/index.js`, `backend/README.md`, generated `backend/cloudformation.json`; `catalog-live.js`; core/presentation/filter/navigation sections of `index.html` (generated clients only via build); `scripts/browser-catalog.cjs`; `tests/backend-cache.cjs`, `tests/backend-runtime.cjs`, `tests/adapter-cursor.cjs`, `tests/repository.test.cjs`; new `scripts/channel3-cost-model.cjs`, `tests/channel3-cost-model.cjs`; cost docs/scenarios/browser evidence and narrow legacy-denial JSON in this directory.

Index ownership released to root after successful browser verification. No further frontend writes planned. Next: independent teammate review of this delta, address demonstrated findings only, then root canonical build/full final verification/commit/artifact export. External gates: approved allocations, actual provider account evidence, legacy/all-consumer isolation, backend rollout, real conditional-write/rate/notification acceptance. No claim of commercial or operational readiness.
