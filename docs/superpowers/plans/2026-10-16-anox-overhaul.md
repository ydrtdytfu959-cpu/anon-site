# AnoX repair implementation plan

**Goal:** Restore valid approved-retailer discovery, expose source limitations, and support a truthful, non-payment service request through the existing Astra interface.

**Spec:** `docs/reviews/overhaul-request.md`. The owner explicitly authorizes implementation and ordinary engineering decisions without another planning approval.

**Architecture:** Preserve the single-file storefront and canonical client modules. Keep provider budget enforcement server-side; filter by verified official merchant identity. Extend the existing authenticated commerce records for service requests, with no purchase or fee collection. Generate all deployment snapshots from canonical sources.

**Constraints:** Six approved retailers; fixed proposed $5 fee with trigger undecided; Algeria; no fake inventory, payments, budget increases, production mutations, merge, or deployment.

## Execution and verification

- [x] Fresh isolated clone from main `c6c5895`; compare production HTML; inspect open PRs and branches. Baseline check and 293 Node tests pass.
- [x] Catalog backend: add failing tests for normalization losses, rejected-record accounting, scoped merchant filtering, pagination duplicates/cycles and cache behavior. Repair `backend/index.js` and verify backend tests.
- [x] Catalog frontend: regress `website_ids` wiring, merchant/brand distinction, duplicate mixing, partial availability and cursor recovery. Repair `catalog-live.js`, retain strict merchant evidence and presentation-only cache. Update source fixtures where contracts are corrected.
- [x] Commerce: regress nullable merchant links, undecided fee trigger, six-retailer input validation and authenticated idempotent service requests. Repair `backend/commerce`, `commerce-client.js`, and add gated Astra request/tracking controls.
- [x] AWS and sources: read-only runtime, budget, IAM, legacy secret access and cached coverage verification; preserve evidence and separate live findings from simulations. Never request secrets or paid provider calls.
- [x] Generate templates/client bundle and run npm ci --ignore-scripts, build, check, complete Node tests, Chromium+Firefox desktop/mobile suites. Add browser regression for service request and source failure states.
- [ ] Independent code review, address material findings with tests; record remaining provider/owner blockers; commit and publish reviewable PR with rollback instructions.

## Review focus

1. One failing source must not suppress valid records from others or become an ordinary empty state.
2. Cursor replay, changed filters, duplicates and sparse pages must not skip genuine records or trigger uncontrolled metered work.
3. Official merchant identity does not imply brand identity, provider licensing, payment authority or verified stock.
4. Service requests must isolate customers, resist replay/concurrency and remain distinct from paid merchant orders.
5. Current runtime and zero-cost mocked verification must never be reported as live six-retailer acceptance.

## Ownership

Root: frontend/catalog tests, Astra integration, release assembly. Catalog agent: catalog backend and its tests. Commerce agent: commerce source/client/templates and tests. AWS agent: read-only evidence. Generated snapshots are assembled by root after source changes settle.
