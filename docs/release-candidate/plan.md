# AnoX release candidate implementation plan

**Goal:** resolve safe source-level release blockers and prepare exact, independently reviewable staging and commercial integration work, without deploying or spending provider credits.

**Baseline:** `dd11ddedf277d74446d77af6836a67ee30abebf7`, clean `feat/anox-commerce-foundation`; retains Phase 1 `b0ac4df` and main `9b81ec5` ancestry. Prior remediation artifacts remain immutable. The user's Production Release Engineering Mission is the controlling specification and authorizes autonomous development, not infrastructure or payment activation.

**Architecture:** preserve the native-cursor catalog, provider registry, namespaced commerce, owner-bound transactions and blocked checkout. Presentational search cards must not reuse volatile price/offer/stock evidence. Fresh PDP/quote data remains independently validated for at most30seconds. Delivery evidence contracts are server-only and default unknown; staging gets isolated resources and a separately approved plan, never automatic production mutations.

**Constraints:** no main push/merge/history rewrite; no deployment/upload/change set/quota change; no production IAM/CORS/financial change; no secrets retrieval, merchant orders, fees or paid API requests. Keep exactly500USD cents conditional per successful order. Preserve approved merchant scope, image budget, restrictive CSP/auth and unknown delivered totals.

## Work items and owners

- [x] Recover clean branch, latest reports, artifact manifest and ancestry; preserve completed baseline.
- [ ] Cost/cache owner: verify official pricing/cache terms; implement presentation-only cache cards and honest filters/sorts with red/green regressions; prepare shared-credential bypass isolation proposal; produce reproducible100/1k/10kMAU best/base/stress costs with explicit assumptions.
- [ ] Shipping owner: add strict server-side delivery provider/evidence interfaces, expiry/binding/parcel/currency validation and disabled default; retain unknown totals; document actual Algeria carrier/customs/input requirements using official sources.
- [ ] Infrastructure owner: fresh read-only AWS inventory/quota/route/IAM evidence; isolated staging template/acceptance preparation; deployment prerequisites, capacity fallback, reversible incremental CORS and resource protection. No cloud writes or tests needing approval.
- [ ] Root: verify legacy payment isolation and remaining client/contract gaps; document migration proposal and complete merchant/payment orchestration specification with explicit approval gates; inspect and test demonstrated defects only.
- [ ] Independent review: cross-review all deltas, reproduce findings and correct before freezing sources. Distinguish local fixtures from AWS/provider evidence.
- [ ] Final verification: locked install, official build/check, complete Node, Chromium/Firefox desktop/mobile/135 embedded tests, lint/Guard/syntax/CSP/parity/whitespace, offline preflight, immutable archive build/checksums.
- [ ] Finalize issue register, separate Release A/B verdicts, source-vs-deployed comparison, exact commands/runbook, durable checkpoint; commit/publish only feature branch with guarded head update; keep draft PRs unmerged; export fullHTML/source/evidence and stop.

## Review focus

1. Cache-policy correction must not fabricate prices/options, drop products through local price filters or increase per-card calls; older payloads must also be safe.
2. Delivery evidence must be bound to canonical parcel/address/service inputs and expiry; client values or stale estimates cannot become verified payable amounts.
3. Staging tooling must fail closed against production identity, resource replacement, implicit paid allocations and unapproved execution.
4. Legacy public sandbox exposure remains an approval-dependent production surface; blocked new checkout cannot silently fall back to it.
5. Zero-default budgets need an explicit reconciled launch allocation; backup recovery and other credential consumers cannot silently grant or bypass allowance.

No additional confirmation is needed for these source tasks under the user's explicit autonomous instruction. Commercial roles, real-service tests, infrastructure operations and spending remain separate decisions.
