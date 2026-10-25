# Legacy shipping reconciliation candidate

Recovered from the deployed legacy source and verified against its code archive checksum. This candidate changes only tracking reconciliation: the receipt and state advancement use one conditional transaction; duplicate replay remains safe after later state changes; concurrent delivery cannot be overwritten.

The existing sandbox-only carrier adapter is preserved. This source is **not** connected to the storefront or included in the catalog/commerce deployment generators. Publishing it does not enable shipping, purchase labels, expose an endpoint, or authorize any production update.

The transaction uses the existing per-item PutItem/UpdateItem permissions. Exact, strongly consistent receipt lookups use the existing Query permission on the tracking base table. No IAM widening is proposed. The isolated SDK fixture models atomic failures, concurrent delivery, replay after an ambiguous commit, and invalid transitions. A real staging transaction and independent final review remain release gates.

Existing historical receipts are retained. Receipts created by older code are not automatically repaired or reinterpreted; any uncertain historical reconciliation requires an operator-reviewed, separately authorized procedure.

For an approved future deployment, capture the current stack/source and verify its drift against the review evidence. Replace only the reviewed inline function code in a privately prepared existing template; preserve routes, role, environment, alarms and data resources. Validate the template and inspect the change set before requesting approval. Keep the previous code artifact for rollback, preserve all counters/records, and do not activate label or quote operations as a deployment check.
