# AnoX release candidate assessment and issue register

This continues the completed remediation at `dd11ddedf277d74446d77af6836a67ee30abebf7` on `feat/anox-commerce-foundation`. The final export manifest pins the candidate commit, tree and every source file; it is the authority for artifact identity. Historical evidence under `docs/remediation/` and `docs/phase1/` is preserved with its original scope and dates.

**Release A: independent review candidate; production activation remains blocked by the open gates below. Release B: BLOCKED — EXTERNAL APPROVAL and missing operational integrations.** No deployment, merge, quota/IAM/CORS mutation, paid provider read, secret-value retrieval, payment, merchant order or customer-data mutation was authorized or performed for this candidate. Final test disposition is in [validation.md](validation.md); no source-only or fixture result is cloud certification.

## Executive technical assessment

The reviewed architecture can support a nonfinancial storefront foundation: cursor-based discovery, bounded product hydration, exact merchant/variant selections, persistent cart, fresh owned quotes and disabled purchasing. Channel3 search cards now carry presentation data only. They expose no cached offer, price, stock or fabricated variant, and no per-card detail fanout is introduced. A deliberate product open obtains fresh detail; the server still independently revalidates a quote within the strict 30-second bound. Missing tax, shipping and customs amounts remain unknown. Exactly one conditional 500 USD-cent fee is represented per successful-order intention; the foundation collects nothing.

This release adds strict server-internal delivery interfaces, not a carrier integration or a guaranteed landed-cost engine. The isolated staging generator and nonexecuting acceptance protocol prepare real AWS verification without attaching to production. Independent review identified additional client admission and staging-auth/contract mismatches; completed corrections and red/green evidence are recorded separately.

The live API still lacks the new detail and commerce endpoints. Its concurrency allocation, missing notifications, legacy shared-key access and legacy sandbox checkout are independent release gates. Zero default upstream allocation deliberately prevents new spending; production availability needs an approved reconciled allowance, not an arbitrary higher limit. Merchant ordering rights, payment roles, final delivered costs and refund/reconciliation responsibilities remain unestablished. Neither a Stripe sandbox nor catalog access makes an operational commerce business.

## Five distinct evidence categories

| Category | Established scope | Excluded claims |
| --- | --- | --- |
| Implemented source | Canonical frontend/backends, generated HTML/templates, bounded cache/budgets, exact-money owned quotes, disabled checkout, staging preparation and delivery contracts. | Deployed endpoints, approved spending, real carrier/payment adapters. |
| Automated verification | Full commands, exit codes and fixture boundaries in [validation](validation.md). Real handlers/builds execute with injected dependencies; desktop/mobile Chromium and Firefox exercise the HTML. | Cognito signature verification by real Gateway, real DynamoDB contention, merchant or payment success. |
| Read-only real AWS | Dated [API/quota state](aws-state.json), [tables](aws-tables.json), [shared-key roles](aws-shared-key-roles.json). | New-service acceptance, full organization-wide effective IAM, current Lambda ZIP equality, customer/payment data review. |
| Deployed functionality | Existing catalog/legacy account/payment/shipping resources only, as captured. | This candidate, isolated staging, detail or commerce endpoints, new budgets/alarms. |
| Commercial authorization | No supported merchant purchasing/payment/delivery arrangement was proven. | Ability to collect funds or fees, arbitrary-retailer Connect settlement, approved new brands. |

## Complete continuing issue register

Severity is preserved from the original review. “Corrected” means source and automated verification only. All open P0/P1 items remain gates for the specified target; preparation is not closure.

| ID | Severity | Current disposition and dependency |
| --- | --- | --- |
| REL-01 | P0 | **BLOCKED — staging/deployment approval.** Real AWS still has 16 legacy routes; eight additive detail/commerce routes are absent. Isolated nine-route staging proposal exists; backend contracts and real two-customer acceptance must pass before frontend promotion. |
| REL-02 | P0 | **BLOCKED — EXTERNAL APPROVAL (Release B).** No merchant ordering contract, participating payment arrangement or final-cost guarantees. [Activation specification](checkout-activation-spec.md) defines exact prerequisites; checkout remains disabled. |
| REL-03 | P0 | **BLOCKED — quota approval.** Fresh AWS capture remains 10 total/10 unreserved. Preserve the 100-unreserved floor: default production commerce reservation needs at least 102 available; staging catalog 3 plus commerce 2 needs 105. Existing reservations and workloads require recheck. No quota requested. |
| REL-04 | P0 | **BLOCKED — separately approved legacy isolation.** Public legacy sandbox checkout has incompatible synthetic prices/7.5% fee/shipping. New frontend cannot fall back. [Isolation proposal](legacy-isolation-proposal.md) preserves receipt processing/history and requests explicit containment authorization. |
| COST-01 | P1 | **Corrected in source; deployment pending.** Zero default allocation, explicit month/free/paid/detail policies and atomic monthly/daily/shared reservations remain. No new paid budget was enabled. |
| COST-02 | P1 | **Corrected in source; deployment pending.** Safe budget/config error metrics retained; new namespace validation separates staging from production. |
| COST-03 | P1 | **Source correction prepared.** Schema-2 caches contain presentation-only cards; old payload volatile fields are discarded client-side. No cached price/offer display or per-card paid refresh. Current policy interpretation and remaining account-specific obligations documented in [cost report](channel3-cost-and-compliance.md); provider permission is not fabricated. Coordinated rollout is mandatory. |
| COST-04 | P1 | **BLOCKED — operational/IAM approval.** Deployed budgets/alarms absent. Catalog-API directly reads the same secret; Chat → Smart-Catalog → Catalog-API is an indirect bypass. Proposed exact isolation and reconciliation must be approved; local counters cannot cap unrelated provider consumers. |
| SEC-01 | P1 | **Corrected in source.** All quote snapshots expire within 30 seconds including provider overlong expiry/skew cases; server freshness remains independent of card cache. |
| PDP-01 | P1 | **Corrected in source.** Merchant/condition URL selection survives reload. |
| PDP-02 | P1 | **Corrected in source.** Cross-product option identity follows the documented product and preserves explicit option intent/edit context. |
| PDP-03 | P1 | **Corrected in source.** Ambiguous merchant offers and unknown selected stock fail conservatively. |
| PDP-04 | P1 | **Corrected in source.** Exact unit/quantity/subtotal, merchant/selection and price-change notices; malformed quote responses rejected. |
| PDP-05 | P1 | **Corrected in source.** Bounded gallery thumbnails remain reachable; failed-image retry and media safeguards retained. |
| CLIENT-01 | P2 | **Corrected in source.** Only supported commerce routes, ten lines/five selections; legacy checkout denied. |
| CLIENT-02 | P2 | **Corrected in this candidate.** Browser ID/hash/DNS/UTF-8 admission now matches backend; duplicate selections rejected independent of quantity and option order. Independent review found the duplicate mismatch; regression observed red then green. |
| OPS-01 | P1 | **BLOCKED — real staging acceptance.** Prepared explicit Cognito, ownership, DynamoDB contention, Lambda invoke, latency, alarm and rollback matrix; none is represented as executed AWS integration. |
| OPS-02 | P1 | **BLOCKED for increased quote limits.** Preserve 10 lines/five option snapshots, max three hydrations/nine seconds. Fifty local cart entries are storage capacity, not automatic quote capacity; actionable errors avoid truncation. Offline profile exists; real cost/latency needed before raising limits. |
| FIN-01 | P1 | **BLOCKED before Release B.** No operational disputes/pending refunds/fee-transfer reversal/reconciliation ledger. Detailed implementation and sandbox acceptance specification prepared; disconnected webhook foundations do not close this gate. |
| FIN-02 | P1 | **BLOCKED before financial activation.** Approve long-lived financial operation/audit and customer-data retention/erasure policy. Existing 24-hour nonfinancial claim cleanup cannot become payment idempotency policy. |
| LEG-01 | P1 | **BLOCKED — separate legacy authorization.** Retry identity and post-session persistence/ownership may orphan sandbox operations. No live legacy change permitted; containment/reconciliation proposal supplied. |
| LEG-02 | P1 | **BLOCKED for legacy shipping reuse.** Test-mode post-payment shipping is not a verified pre-checkout Algeria quote. New strict disabled delivery contract avoids synthetic payable amounts. |
| OPS-03 | P1 | **BLOCKED — protection/recovery approval.** Existing cache PITR/deletion protection remain off; canonical proposals protect tables. Counter restores must halt upstream dispatch and reconcile usage before reopening; no restored allowance may be treated as fresh. |
| OPS-04 | P1 | **BLOCKED — artifact/deployment approval.** Private TemplateURL required; current production frontend/actual ZIP identity must be captured immediately before an approved change. No upload/change set performed. |
| TOOL-01 | P1 | **Corrected in source.** Offline preflight rejects malformed/broad/mismatched metadata; it is not deployment authorization. |
| TOOL-02 | P1 | **Corrected in source.** Complete committed source inventory and deterministic export; current evidence paths point to this candidate. Final artifact verification pins exact bytes. |
| OPS-05 | P2 | **Open with bounded workaround.** Fixed-window anonymous limits permit boundary bursts and do not establish per-customer fairness. Shared ceilings and conservative throttles bound upstream work; usage reconciliation remains required. |
| STAGE-01 | P1 | **Prepared in source; actual staging blocked.** Separate API/Cognito/tables/runtimes/metrics, no production credential, zero default allowance and reserved concurrency. Independent review addresses password-flow and expected-status parity. Actual stage behavior needs approval and acceptance evidence. |
| SHIP-01 | P1 | **BLOCKED — external carrier/merchant/customs inputs.** Request/evidence validators and failure contracts implemented with exact integers, immutable references and unknown totals. No service availability, parcel facts, delivered quote or customs guarantee inferred. |

## Source versus deployed state

Fresh metadata continues to show API `zmumi2wruk` in account `427064007352`, region `us-east-2`, with `$default` AutoDeploy enabled. Existing origin is only `https://anox.app`; no `Idempotency-Key` preflight allowance. No regional alarms were returned. New source must not be shipped as if these dependencies already exist. The production tables and routes were not changed.

The candidate changes catalog response semantics: old frontend versions require a price and would discard presentation-only cards. The new frontend accepts the old backend while deliberately discarding its volatile fields, but its detail/commerce workflow requires the additive routes. A reviewed maintenance rollout, or separately reviewed additive-route preparation followed by new frontend then presentation-only search runtime, is necessary. Do not deploy the new search response first to the old frontend. Do not roll back by re-enabling cached price display.

Catalog cache schema invalidation affects presentation pages/cursors only. Old cursors explicitly expire rather than silently restarting page one. Spending counter identities must remain stable across schema changes. Staging has a separate credential/table/metric namespace; it cannot borrow production counters or consume a provider allowance assumed to be free.

## Release decisions and next authority boundary

**Release A — READY FOR INDEPENDENT REVIEW** applies only after the final offline validation and archive checks recorded in this package succeed. It means the source can be independently reviewed with an explicit unresolved approval ledger. It does not mean production readiness or controlled-deployment readiness. Staging/quota/budget/IAM isolation/alarms/provenance and legacy-containment gates remain open.

**Release B — BLOCKED.** Merchant ordering authorization, approved payment/funds roles, exact delivered costs and operational refund/reconciliation evidence are missing. The required next step is commercial/provider authorization and review of the supplied specification, not enabling an environment flag or simulated checkout.

The dependency-aware [deployment and rollback runbook](deployment-and-rollback.md), [AWS staging preparation](infrastructure-staging.md), [security assessment](security-assessment.md), [completed fixes](completed-fixes.md), [cost report](channel3-cost-and-compliance.md), [delivery matrix](algeria-delivery.md) and [checkout specification](checkout-activation-spec.md) make the remaining decisions explicit. PR #5 precedes draft PR #6; both remain unmerged. Stop for independent review before requesting any operational change.
