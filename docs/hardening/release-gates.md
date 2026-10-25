# Hardening candidate release gates

This branch is a review candidate. **No merge, deployment, live permission change, or identity setting change is authorized.** Detailed operational evidence and security findings are kept in the owner's private evidence directory.

## Reproduce local verification

Use Node 24 and the locked Playwright dependency:

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
npx playwright install chromium firefox webkit
ENGINES=chromium,firefox,webkit npm run test:browser
```

The browser suites load the real frontend and CSP but intercept external traffic. They verify fixture behavior without consuming provider credits or accessing real accounts. Optional `HARDENING_SCREENSHOTS=/private/local/directory` on `scripts/browser-hardening.cjs` saves two desktop/mobile evidence images. These intentionally include hostile text as literal product data to verify escaping; they are not catalog or design mockups.

## Before any authorized rollout

1. Resolve all independent-review findings and confirm CI on the exact published tree. Preserve the prior release artifacts and the current production checksum.
2. Re-capture configuration and compare it with the reviewed proposal. Verify allocations, unchanged spending ceilings, paid usage disabled, checkout/fee collection disabled, and no unrelated resource or customer-data changes.
3. Follow [budget-renewal.md](budget-renewal.md). Code approval cannot establish a provider allocation. Obtain explicit owner approval for the final change set and its operational effects.
4. Validate the catalog and staging templates. Use the existing deployment mechanism and inspect replacements, permissions, alarms, schedules and parameter diffs. Existing optional alarm destinations need an operator delivery check; a passing local template validator does not prove alerts arrive.
5. Legacy webhook and shipping sources are separate candidates. Follow their source preparation notes; do not silently bundle them into an unrelated stack update or activate dormant services.
6. Use approved isolated QA identities and staging to verify real authorization and DynamoDB transaction behavior. Fixture tests do not prove production identity configuration, carrier availability, or provider entitlement.
7. After an approved release, perform bounded checks against the actual deployed commit. Check anonymous rejection on private routes, capability safeguards, accessible navigation and cached presentation first. Metered requests require a fresh allowance check and a fixed request bound.

## Rollback

Keep the previous frontend build and exact backend code/template/parameters before rollout. If a regression occurs, restore only affected reviewed code through the normal release mechanism. Do not replace/delete tables, replay provider purchases, alter historical spending counters, widen IAM, or enable payment collection.

The preceding catalog runtime understands one approved month only. After a UTC month rollover, restoring that runtime with the older month would stop new reservations. A rollback therefore requires reviewed current-month parameters and reconciled remaining allocation; otherwise fail closed and retain permitted cached presentation. Never increase a cap or reset usage to make rollback appear successful. Legacy rollback must retain historical event records and account for transactions already committed by the newer code.
