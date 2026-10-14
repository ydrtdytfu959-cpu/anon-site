#!/usr/bin/env node
'use strict';
// Nonexecuting plan validator. No fetch, AWS SDK, shell executor or token input.
const fs = require('node:fs');
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function exactKeys(value, names) { return record(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)); }
function prepareAcceptance(input) {
  if (!exactKeys(input, ['schemaVersion','account','region','apiId','stage','stackName','sourceCommit','templateSha256','customerAliases','approval','budgets']) || input.schemaVersion !== 1 || input.account !== '427064007352' || input.region !== 'us-east-2' || !/^[a-z0-9]{10}$/.test(input.apiId) || input.apiId === 'zmumi2wruk' || input.stage !== '$default' || !/^AnoX-Staging-[A-Za-z0-9-]{1,42}$/.test(input.stackName) || !/^[a-f0-9]{40}$/.test(input.sourceCommit) || !/^[a-f0-9]{64}$/.test(input.templateSha256) || !Array.isArray(input.customerAliases) || input.customerAliases.length !== 2 || !input.customerAliases.every(v => /^[a-z][a-z0-9-]{1,30}$/.test(v)) || JSON.stringify(input.customerAliases) !== JSON.stringify(['customer-a','customer-b']) || !exactKeys(input.approval,['reference','granted']) || typeof input.approval.granted !== 'boolean' || !/^[A-Za-z0-9_-]{1,100}$/.test(input.approval.reference) || !exactKeys(input.budgets,['searchRequests','detailRequests','awsRequests','writes'])) throw Error('Invalid isolated staging plan; production targets, credentials and unknown fields are forbidden.');
  const ceilings = { searchRequests:3, detailRequests:25, awsRequests:100, writes:40 };
  for (const [key, cap] of Object.entries(ceilings)) if (!Number.isSafeInteger(input.budgets[key]) || input.budgets[key] < 0 || input.budgets[key] > cap) throw Error('Acceptance budget is missing, unsafe or exceeds this reviewed protocol.');
  const requests = [
    ['capabilities','GET','/commerce/capabilities','none',200,'checkout.enabled=false; fee=500 conditional; quotes enabled'],
    ['unauthorized','GET','/commerce/orders','none',401,'no customer fields'],
    ['invalid-jwt','GET','/commerce/orders','invalid',401,'invalid signature issuer audience or expiry never admits request'],
    ['empty-orders','GET','/commerce/orders','customer-a',200,'only A partition; no B orders'],
    ['foreign-order','GET','/commerce/orders/${customerBOrderId}','customer-a',404,'indistinguishable from missing order'],
    ['unknown-order','GET','/commerce/orders/${unknownOrderId}','customer-a',404,'safe response'],
    ['quote-schema','POST','/commerce/quotes','customer-a',400,'reject client prices before provider dispatch'],
    ['preflight','OPTIONS','/commerce/quotes','none',204,'origin=https://anox.app; idempotency-key allowed; no wildcard'],
    ['quote-create','POST','/commerce/quotes','customer-a',201,'fresh lines exact integer subtotal unknown delivered total'],
    ['quote-replay','POST','/commerce/quotes','customer-a',201,'same key/body yields same quote and one audit'],
    ['quote-key-conflict','POST','/commerce/quotes','customer-a',409,'same key changed body rejected'],
    ['quote-foreign-owner','POST','/commerce/checkout-attempts','customer-b',404,'A quote invisible to B'],
    ['quote-expired','POST','/commerce/checkout-attempts','customer-a',409,'expired quote never creates order/payment'],
    ['attempt-blocked','POST','/commerce/checkout-attempts','customer-a',201,'status=blocked no payment/order'],
    ['owned-cancel','POST','/commerce/orders/${customerAOrderId}/cancel','customer-a',409,'unsupported no write'],
    ['owned-refund','POST','/commerce/orders/${customerAOrderId}/refund','customer-a',409,'unsupported no write'],
    ['catalog-first','GET','/catalog/search?q=${approvedQuery}&limit=10','none',200,'record next token and cache result'],
    ['catalog-next','GET','/catalog/search?q=${approvedQuery}&limit=10&page_token=${issuedToken}','none',200,'real cursor; no duplicates'],
    ['catalog-detail','GET','/catalog/channel3/products/${approvedProductId}','none',200,'fresh bounded detail and correct variants']
  ].map(([id,method,path,identity,expectedStatus,assertion]) => ({ id,method,path,identity,expectedStatus,assertion,classification: id.startsWith('catalog-') || id === 'quote-create' ? 'Real provider read' : 'AWS integration' }));
  const blockers = [];
  if (!input.approval.granted) blockers.push('EXPLICIT_APPROVAL_REQUIRED');
  if (input.budgets.searchRequests < 3 || input.budgets.detailRequests < 25 || input.budgets.awsRequests < 100 || input.budgets.writes < 40) blockers.push('REVIEWED_FULL_MATRIX_BUDGET_REQUIRED');
  return { schemaVersion:1, target:{account:input.account,region:input.region,apiId:input.apiId,baseUrl:`https://${input.apiId}.execute-api.us-east-2.amazonaws.com`,stackName:input.stackName}, sourceCommit:input.sourceCommit, templateSha256:input.templateSha256, approvalReference:input.approval.reference, approvalIsOperatorSupplied:true, executed:false, secretsWritten:false, readyToExecute:blockers.length===0, authorizesDeployment:false, authorizesPayments:false, blockers, providerAttemptUpperBound:{search:3,detail:25}, budget:input.budgets, requests, executionRequirements:['Human must verify actual approval; a JSON boolean is not authority.','Use a separately reviewed runner/operator that enforces cumulative counts before every dispatch; this file executes no requests.','Stop on first unexpected response or budget exhaustion. Do not retry an ambiguous mutation with a new key.','Acquire two real staging Cognito ID tokens in memory; never save token/customer payloads in evidence.','Create owned-order fixtures only by separately approved staging-only seeding; no production table or merchant order.','Concurrency, DynamoDB/IAM/alarms/rollback tests require the additional evidence matrix in infrastructure-staging.md.'] };
}
if (require.main === module) { try { if (process.argv.length !== 3) throw Error('Usage: node scripts/prepare-staging-acceptance.cjs approved-plan.json'); const result = prepareAcceptance(JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))); process.stdout.write(JSON.stringify(result,null,2)+'\n'); if (!result.readyToExecute) process.exitCode=2; } catch (error) { process.stderr.write(error.message+'\n'); process.exitCode=1; } }
module.exports = { prepareAcceptance };
