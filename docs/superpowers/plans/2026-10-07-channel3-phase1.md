# Channel3 Phase 1 Implementation Plan

> **For agentic workers:** Execute independent tasks with test-driven development; root integrates and reviews the full branch.

**Goal:** Correct, broad, credit-efficient Channel3 browsing without changing commerce.
**Architecture:** Cursor-aware provider/repository contexts, lazy discovery sections, and a server-side DynamoDB cache in the existing Channel3 Lambda path.
**Tech Stack:** Vanilla JavaScript, Node 24 Lambda, API Gateway HTTP API, DynamoDB, Secrets Manager, CloudWatch.
**Spec:** docs/phase1/design.md

## Global Constraints

- Keep auth, CJ/Nike, cart/checkout/payment/shipping/fees behavior unchanged.
- No main edits or merge; deliver complete root index.html from the feature commit.
- No secret reads in the agent, logs, client output, or repository.
- 24 products and one image each must fit existing pixel budget.

## Review Focus

- Context changes during an append never leak old results or restart a chain.
- Shared cache lease expiry/failure does not allow duplicate successful upstream requests.
- Cache identity preserves all semantic input and opaque cursor bytes.
- Cached response freshness and cursor retention must not imply fresh source data.
- HTML build must not weaken active adapter validation or change unrelated code.

### Task 1: Canonical adapter and packaging
- [x] Test real page_token transport, malformed payload/cursor, safe single-image normalization and fetched timestamps.
- [x] Promote active inline adapter to catalog-live.js and implement q/section/cursor context options.
- [x] Build/check script replaces the exact inline module and recalculates CSP; add CI drift checks.
- [x] Run adapter tests and JS/CSP checks.

### Task 2: Provider/repository and existing UI
- [x] Add failing tests for three pages, deduplication, abort/stale races, independent contexts, provider statuses and retry.
- [x] Implement native cursor protocol alongside existing offset protocol; preserve budgets.
- [x] Add lazy section selection using current UI; render every accepted page without numeric slicing losses.
- [x] Run repository and browser checks.

### Task 3: Backend caching and observability
- [x] Add failing tests for cache keys, miss/write/hit, expiry, lease contention, malformed entries/cursors and failures.
- [x] Implement sanitized bounded Channel3 proxy, persistent cache/lease/cursor state and structured metrics.
- [x] Define minimal stack update: separate cache table and dedicated least-privilege role; existing endpoint/CORS preserved.
- [x] Run local tests and validate template before any deployment.

### Task 4: Integration and release evidence
- [x] Verify reviewed backend through AWS, using a small bounded live smoke sequence.
- [x] Verify browser flow, baseline behavior, syntax, build parity and final CSP.
- [x] Perform whole-branch independent review and second self-review; fix findings and rerun affected tests.
- [ ] Commit, push feature branch, create unmerged PR and attach it to task.
- [ ] Provide complete exact index.html; latest user instruction requires the final response to contain only the full HTML file. Put implementation evidence in the PR and validation document, then stop for review.
