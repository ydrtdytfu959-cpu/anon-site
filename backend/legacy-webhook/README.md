# Legacy sandbox reconciliation candidate

This canonical source was recovered from the deployed legacy webhook on 2026-10-23 and hardened with isolated, signed fixtures. It is separate from the inactive commerce webhook foundation. It does not enable checkout, charges, refunds, or merchant purchases.

The candidate preserves raw-body signature validation, sandbox-only events, exact order/session/amount/currency binding, and atomic event/payment/order writes. Repeated settlement and late pending notifications preserve terminal state, while concurrent state changes are checked by the transaction. Historical reconciliation remains supported; unsupported event types retain the existing ignored response and require operator reconciliation where relevant.

No deployment is authorized. The existing legacy stack is not owned by the catalog/commerce build generators. Use `prepare-template.cjs` with a freshly captured existing stack template; it updates only the identified inline webhook source and fails if the expected source hash or resource identity has drifted. Save the proposed template privately, validate it, review the change set, obtain approval, and retain the preceding code/config for rollback. Do not replace the stack, alter routes/permissions, or touch historical records.
