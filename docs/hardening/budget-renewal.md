# Explicit allocation renewal

Review candidate only. No production settings or counters were changed.

The runtime accepts `BudgetMonth` and, optionally, its immediate successor `NextBudgetMonth`. Both use the existing caps; neither advances automatically. Cached presentation remains available under its existing retention rules. New search/detail reservations fail closed outside approved months. Counter identities remain based on the actual UTC period, so changing configuration cannot reset usage.

The proposed hourly private EventBridge check does not read credentials, counters, customer records, or provider APIs. It emits month availability, a seven-day expiry warning, and a heartbeat. Three alarms use the existing optional alarm topic. Verify that the topic is connected to a monitored destination; without it, alarms are visible but do not notify an operator. These resources require deployment approval and normal AWS operation costs.

## November review

Before **2026-11-01 00:00 UTC**, the owner must verify the provider's allocation for November and reconcile all other credential consumers. The old reported provider balance is not evidence of a new allocation.

If the verified November allocation covers the existing approved limits, deploy this reviewed runtime/template with `BudgetMonth=2026-10` and `NextBudgetMonth=2026-11`. Preserve every other existing parameter using `UsePreviousValue`, including monthly searches **500**, daily searches **60**, monthly details **200**, daily details **100**, daily total **150**, and requests per second **5**. Paid usage stays **false**, paid credits **0**. Do not replace October with November early: the old runtime would immediately reject October reservations.

If the provider allocation is insufficient or unverified, leave the successor blank. Report the resulting availability limitation; do not enable paid usage or invent credits. Approving this code does not itself attest to a provider allocation.

`scripts/prepare-budget-renewal.cjs` generates an offline parameter proposal. Supply a restricted JSON object of the **fresh stack's current parameter values**, and a separate owner-reviewed JSON object containing:

```json
{
  "month": "2026-11",
  "ownerApproved": false,
  "providerAllocationVerified": false,
  "otherConsumersReconciled": false,
  "availableFreeSearchCredits": 0,
  "availableDetailRequests": 0
}
```

These deliberately unapproved example values fail validation. Populate them only from actual review. Run `node scripts/prepare-budget-renewal.cjs parameters.json approval.json > renewal-plan.json`. The tool makes no network or deployment call; its `.parameters` array is the reviewed CloudFormation parameter input. It refuses ceilings above the approved limits and omits unrelated parameter values from its output. If the current month is not already approved, stop and reconcile that allocation separately. During an already approved successor month, the next renewal promotes that month to `BudgetMonth` and explicitly approves its successor, retaining the same counter identities.

Before deployment: validate the generated template, examine a change set, confirm no table replacement or counter writes, preserve code/config rollback artifacts, and obtain owner approval. After deployment: verify the private monitor reports the approved month, alarm delivery and the unchanged caps. Use bounded provider checks only after reconciling current counters. Rolling code back to the old single-month runtime requires a separately reviewed current `BudgetMonth`; blindly restoring an expired month would restore the outage. Never restore or delete usage counters.
