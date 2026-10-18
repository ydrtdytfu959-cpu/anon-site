# ASTRA — ANOX COMPLETE ENGINEERING OVERHAUL

**MISSION: MAXIMUM-EFFORT ROOT-CAUSE REMEDIATION, FULL CATALOG RESTORATION, SYSTEM INTEGRATION, AND PRODUCTION-GRADE QUALITY**

**Priority: P0 — CRITICAL**

You are hereby assigned as the **Lead Principal Software Engineer, Systems Architect, and Quality Assurance Engineer** responsible for bringing AnoX to the highest achievable level of technical quality, reliability, functionality, and production readiness.

This is an **execution mission, not a planning exercise**.

I expect your strongest engineering capabilities, rigorous reasoning, comprehensive debugging, and professional implementation standards.

Do not deliver superficial fixes, temporary workarounds, cosmetic improvements, incomplete integrations, or lengthy explanations instead of working code.

**Identify the root causes, implement the correct solutions, test them thoroughly, and prove the results.**

## 1. PROJECT INFORMATION

**Repository:** `ydrtdytfu959-cpu/anon-site`

**Production website:** https://anox.app

**AWS Region:** `us-east-2`

**Production API:** `https://zmumi2wruk.execute-api.us-east-2.amazonaws.com`

**Known baseline:** `c6c58956ebc28f61f32509f0848f115907d31a7a`

First, inspect the latest repository state, active branches, pull requests, deployed infrastructure, actual runtime configuration, and production behavior.

Do not rely on outdated documentation when newer deployed evidence is available.

Preserve the existing Astra storefront design, brand identity, layout, working features, authentication, shopping cart, product pages, and user experience.

**Do not rebuild AnoX from scratch. Repair and strengthen the existing system.**

## 2. CRITICAL PRIORITY — RESTORE THE COMPLETE PRODUCT CATALOG

This is the single most important engineering problem.

AnoX currently suffers from insufficient product coverage, inconsistent retailer representation, excessive filtering losses, and fragile product discovery.

The platform must reliably display a rich, diverse catalog of genuine products from these six approved retailers:

1. Nike
2. Adidas
3. Sephora
4. Levi's
5. TJ Maxx
6. e.l.f. Cosmetics

### Mandatory engineering work

- Perform an end-to-end audit of all product providers, adapters, API responses, filtering functions, cache layers, pagination systems, and frontend rendering.
- Trace each product from its original data source to its final appearance in the storefront.
- Identify precisely why products are rejected, missing, duplicated, incorrectly attributed, or never displayed.
- Investigate and correctly integrate the existing server-side `website_ids` filtering capabilities.
- Improve product discovery using actual verified retailer-specific sources.
- Eliminate unnecessary filtering losses while preserving authentic merchant verification and security.
- Ensure fair representation of all six retailers instead of allowing Nike or any other retailer to dominate the storefront.
- Improve search relevance, category coverage, product diversity, pagination, caching, and recovery from partial provider failures.
- Ensure valid available products remain visible when another source fails.
- Preserve accurate product identity, images, descriptions, variants, prices, availability, and official merchant attribution.
- Never invent products, prices, inventory, merchant links, or source authorization.
- Respect provider licensing, API permissions, and caching requirements.

**Success criterion:** Every supported retailer must have independently verified product coverage, with meaningful diversity and reliable browsing. Report actual accepted product counts, rejected product counts, rejection reasons, and unresolved source limitations.

A catalog containing only a handful of products must never be considered a successful result merely because its API returns HTTP 200.

## 3. REPAIR PRODUCT DETAILS AND SHOPPING EXPERIENCE

Audit and correct the complete customer journey:

**Discovery → Product selection → Product details → Options → Cart → Service request → Order tracking**

Verify and repair:

- Product images and galleries
- Product descriptions and specifications
- Size, color, and variant selection
- Merchant identity and official product links
- Price freshness and availability
- Search and filtering
- Category navigation
- Cart persistence
- Quantity management
- Mobile responsiveness
- Loading states
- Error messages
- Empty states
- Expired cursors
- API failures
- Session and authentication behavior

A technical limitation must never silently appear to the customer as an empty store.

Preserve the current Astra visual design. Improve its functionality without unnecessary visual redesign.

## 4. ALIGN THE PLATFORM WITH THE ACTUAL ANOX BUSINESS MODEL

The intended business model is straightforward:

**AnoX connects Algerian customers with products from approved American retailers and provides its service for a fixed $5 fee per qualifying order.**

The original retailer remains responsible for selling its products.

Do not assume that AnoX is authorized to purchase merchandise, collect the retailer's payment, or operate an unauthorized unified merchant checkout.

Inspect the existing Commerce implementation and identify every architectural mismatch with this business model.

Remove reliance on outdated 7.5% fee assumptions from the intended new customer experience.

Design and implement the technically supportable service workflow, including transparent customer information, product references, order records, and tracking.

Preserve the existing fixed-fee requirement, but do not activate any payment collection or decide the legally significant fee trigger without explicit owner approval.

No live payments, Stripe charges, merchant purchases, refunds, or financial transfers are authorized by this instruction.

## 5. AWS BACKEND — COMPLETE TECHNICAL REMEDIATION

Conduct a thorough audit of:

- AWS Lambda
- API Gateway
- DynamoDB
- Cognito
- CloudFormation
- IAM
- Secrets Manager
- CloudWatch
- SNS
- Catalog and Commerce services
- Legacy services and dependencies

The previous audit confirmed that AWS contains 22 API routes, 15 Lambda functions, 8 DynamoDB tables, and a regional concurrency quota of 1,000.

Do not waste time solving historical problems that have already been corrected.

### Critical operational investigation

The deployed Channel3 catalog currently has:

- 60 permitted monthly search credits
- 200 monthly detail requests
- 5 upstream requests per second
- Paid provider usage disabled
- An active `BudgetDeniedAlarm`

Recent CloudWatch evidence also showed seven budget-denial events.

Investigate the actual reasons behind these events and their impact on storefront availability.

Design efficient caching, request deduplication, safe scheduling, controlled pagination, accurate monitoring, and graceful degradation.

Also investigate legacy Channel3 credential access outside the new budget-controlled service.

**Never bypass expenditure controls, retrieve or expose secrets unnecessarily, increase paid provider usage, or silently introduce billable infrastructure.**

Prepare and test safe infrastructure improvements. Apply non-production changes only within authorized environments.

## 6. SHIPPING AND ALGERIA INTEGRATION

Audit the entire shipping architecture, including existing EasyPost, USPS, UPS, FedEx, tracking, and delivery-cost modules.

Identify what is operational, what is simulated, and what remains disconnected.

Implement improvements that can be supported by existing authorized integrations.

Ensure that estimates, unknown charges, delivery methods, and tracking information are presented honestly.

Never fabricate customs duties, guaranteed arrival dates, or final delivered prices.

Preserve support for Algeria as the primary destination market.

## 7. SECURITY, RELIABILITY, AND CODE QUALITY

Apply principal-engineer-level standards throughout the system.

Perform a comprehensive review of:

- Authentication and authorization
- Customer data isolation
- API input validation
- Injection and XSS protection
- Payment-related boundaries
- Idempotency
- Race conditions
- DynamoDB consistency
- Secure configuration
- Secret isolation
- Error handling
- Retry strategies
- Resource utilization
- Performance bottlenecks
- Browser compatibility
- Accessibility
- Maintainability

The current root `index.html` is approximately 1.06 MB.

Investigate opportunities to improve modularity, loading performance, maintainability, and architecture without damaging the existing storefront or introducing unnecessary rewrites.

Remove genuinely obsolete code only after proving that no active feature or deployed dependency requires it.

## 8. MANDATORY VERIFICATION

Every meaningful correction must be accompanied by appropriate automated tests.

Execute the complete available verification suite, including:

```bash
npm ci --ignore-scripts
npm run build
npm run check
npm test
ENGINES=chromium,firefox npm run test:browser
```

Add additional regression, integration, security, and browser tests where required.

Test realistic customer flows across desktop and mobile.

Verify individual retailer coverage rather than testing only aggregate catalog results.

Distinguish simulated tests from real infrastructure verification.

Use bounded, authorized live smoke tests where possible. Never incur unapproved provider charges.

**A passing test suite is not sufficient if the real storefront remains functionally broken.**

## 9. ENGINEERING EXECUTION RULES

The following requirements are mandatory:

1. **Do not stop at analysis.** Investigate, implement, test, and correct actual defects.
2. **Do not apply superficial workarounds.** Resolve root causes wherever technically possible.
3. **Do not destroy working functionality.** Preserve the original Astra experience and existing capabilities.
4. **Do not silently change product strategy.** The owner makes business decisions.
5. **Do not substitute fake products or simulated purchases for real integrations.**
6. **Do not describe incomplete work as completed.**
7. **Do not repeatedly request confirmation for ordinary local coding decisions.** Exercise professional engineering judgment within the approved scope.
8. **Do not merge, deploy to production, activate payments, alter paid budgets, or make irreversible infrastructure changes without explicit owner approval.**
9. **Do not abandon unrelated repair tasks when one external dependency is blocked.** Continue fixing everything independently achievable.
10. **Do not finish with a proposal instead of an implementation.** Deliver actual commits, tests, and verified changes.

Use the maximum practical engineering effort. Work systematically, with independent verification of critical changes.

## 10. REQUIRED DELIVERABLES

At completion, provide:

**A. Root-Cause Report**

A precise list of discovered defects, their root causes, affected components, and severity.

**B. Implemented Repairs**

Actual committed code changes with a clear explanation of what was corrected.

**C. Product Coverage Report**

For each of the six retailers, include real source coverage, accepted product counts, rejected records, available details, and unresolved limitations.

**D. AWS Verification**

Document actual runtime compatibility, remaining infrastructure risks, and required authorized changes.

**E. Automated Testing Results**

Report exact pass/fail results, browser evidence, regressions, and remaining failures.

**F. Remaining Blockers**

Clearly separate engineering defects from provider authorization, commercial decisions, and other external dependencies.

**G. Deployment-Ready Pull Request**

Provide a clean, reviewed, reproducible release candidate with rollback instructions. Do not deploy it to production without approval.

## FINAL DIRECTIVE

**AnoX must emerge from this engineering mission substantially more functional, stable, complete, and maintainable than it is today.**

Do not optimize for the number of files changed, the length of your report, or how quickly you can claim completion.

Optimize for verified product functionality, dependable integrations, excellent engineering quality, and measurable improvements to the real customer experience.

The highest priority is fixing the product catalog and eliminating the technical causes of missing or unusable products.

You have authority to investigate, refactor, implement, and test within the designated development environment.

**You do not have authority to override the owner's business decisions or independently authorize production deployment or spending.**

Start immediately. Execute the engineering work, not merely the planning.

**Deliver the strongest technically justified implementation you can produce.**