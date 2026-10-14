# Channel3 consumer isolation — separate approval proposal

**Not executed. No permission to mutate production is implied.** The new runtime's reservations protect only calls routed through it. A known legacy role can read the same secret. This proposal closes that bypass after an approved dependency check; it does not rotate/reveal the key, change CJ access or touch customer/product/payment rows.

Known captured readers of `arn:aws:secretsmanager:us-east-2:427064007352:secret:AnoX/Channel3/Production-22Xm3D`:

| Principal | Source of permission | Intended treatment |
|---|---|---|
| `AnoX-Channel3-Catalog-Channel3Role-3AzyNIuhdUvo` | Exact secret ARN in dedicated catalog runtime policy | Keep as the one budget-enforcing production consumer, subject to code/config attestation. |
| `AnoX-Catalog-API-Role` | Inline `ReadChannel3Secret` | Remove this grant and add the narrow explicit denial below after checking callers. Preserve `ReadCJSecret`, `CatalogTable` and unrelated logging. |

The fresh [shared-key role capture](aws-shared-key-roles.json) confirms these readers and the indirect Chat → Smart-Catalog → Catalog-API invocation chain. The [EventBridge capture](aws-catalog-warmer.json) also shows an enabled six-hour Catalog-API warmer described as CJ warming. Its presence does not prove Channel3 usage; its exact input/source and drain behavior must be reconciled. All twelve captured functions lack Function URLs and reserved concurrency, but that does not rule out other invocation paths. This continues `docs/remediation/aws-iam.json`; it is not exhaustive proof against secret resource policies, users, broad roles, copied credentials outside AWS or warm runtimes. Inspect all current functions' roles and invocation permissions, API targets, event sources and non-AWS consumers, including the older catalog function's callers. An unused HTTP route does not prove a Lambda cannot be invoked internally. Reconcile provider usage and pause unbudgeted consumers before assigning remaining monthly allowance.

Prepared artifact: [channel3-legacy-secret-deny.json](channel3-legacy-secret-deny.json). Its only denied action is `secretsmanager:GetSecretValue` for the exact Channel3 secret on the legacy role. This ensures a future broad allow cannot silently reopen that read while the denial is attached. `BatchGetSecretValue` still requires per-secret GetSecretValue authorization; review this against the current IAM contract before approval. It does not deny CJ or invoke any secret operation.

## Approved cutover prerequisites and sequence

1. Capture current role policies, complete function/route/event-source dependencies, aliases/versions, code/config hashes and secret resource-policy metadata without retrieving any value. Preserve rollback inputs with access controls.
2. If any required service depends on legacy Channel3 access, first prepare an approved adapter that invokes the central budget-enforcing catalog Lambda with scoped IAM. Do not fabricate such a caller or assume the legacy source exists in this repository. If no replacement is reviewed, stop the affected route/function through a separately approved change and disclose temporary unavailability.
3. Configure new upstream allocations to zero/blank and verify fail-closed behavior. Drain approved legacy invocations and eliminate warm processes that may already hold a key. IAM denial alone does not erase a key in process memory. Review alias/version routing and in-flight work before claiming isolation. Do not rotate credentials as an implicit shortcut.
4. After explicit IAM approval, attach the exact reviewed denial, remove the old grant, and verify denial with IAM simulation/CloudTrail/controlled staging evidence without asking an agent to retrieve the value. Use source-level synthetic secret-denial fixtures for ordinary development tests. Preserve CJ permissions and test its existing route independently.
5. Confirm no other approved consumers can call Channel3 outside the accounting boundary. If a provider account key is legitimately shared, either move them to the same accounting design or allocate disjoint reconciled budgets using approved provider-supported credentials/account controls. Do not sum independent 1,000-credit allowances.
6. Reconcile account usage, conservatively seed/preserve counters if necessary, approve a current-month allocation, then perform a bounded separately authorized provider-read acceptance test. Confirm one physical request produces one reservation/metric and identical requests hit cache. Zero unexpected legacy secret reads/invocations is necessary but not proof against outside-AWS use; obtain the account owner's declaration and provider reporting evidence.

The following are review commands, **not an executable deployment script**. Replace nothing automatically; record account/region/role identity and re-check drift before approval. The existing operator must supply the captured previous policy files for rollback.

```sh
# Read-only metadata capture; no secret values.
aws iam get-role-policy --role-name AnoX-Catalog-API-Role --policy-name ReadChannel3Secret > legacy-channel3-policy-before.json

# ONLY after separate authorization and dependency/drain review:
aws iam put-role-policy --role-name AnoX-Catalog-API-Role --policy-name DenyUnbudgetedChannel3 --policy-document file://docs/release-candidate/channel3-legacy-secret-deny.json
aws iam delete-role-policy --role-name AnoX-Catalog-API-Role --policy-name ReadChannel3Secret
```

Rollback must not silently restore an unbudgeted consumer. Default safe rollback leaves the denial and upstream allocations at zero while frontend/service capability is explicitly unavailable. Restoring the old secret grant or removing the denial is itself a new security/spending approval, after consumed usage is reconciled. Preserve the cache/spending table and historical records; never restore older counters merely to make the service available.

Status: **BLOCKED — production change and consumer/account evidence required.** Source artifacts are reviewable; the live bypass is not claimed fixed.
