'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { buildStagingTemplate } = require('../backend/staging/build-template.cjs');
const { prepareAcceptance } = require('../scripts/prepare-staging-acceptance.cjs');
const productionApi = 'zmumi2wruk';
const plan = () => ({ schemaVersion: 1, account: '427064007352', region: 'us-east-2', apiId: 'abc123def4', stage: '$default', stackName: 'AnoX-Staging-Review', sourceCommit: 'a'.repeat(40), templateSha256: 'b'.repeat(64), customerAliases: ['customer-a', 'customer-b'], approval: { reference: 'review-approval-pending', granted: false }, budgets: { searchRequests: 0, detailRequests: 0, awsRequests: 100, writes: 40 } });
test('isolated staging generates independent resources without production identifiers', () => {
  const t = buildStagingTemplate(), serialized = JSON.stringify(t);
  for (const value of [productionApi, 'us-east-2_gUci3YuMm', '63738r9gpr126qpgp1a5cubchi', 'Production-22Xm3D']) assert.equal(serialized.includes(value), false, value);
  assert.equal(t.Resources.StagingApi.Properties.ProtocolType, 'HTTP');
  assert.deepEqual(t.Resources.StagingApi.Properties.CorsConfiguration.AllowOrigins, ['https://anox.app']);
  assert.ok(t.Resources.StagingApi.Properties.CorsConfiguration.AllowHeaders.includes('Idempotency-Key'));
  assert.equal(t.Resources.StagingStage.Properties.AutoDeploy, false);
  assert.equal(t.Resources.StagingStage.Properties.StageName, '$default');
  assert.equal(t.Resources.StagingUserPool.Properties.AdminCreateUserConfig.AllowAdminCreateUserOnly, true);
  assert.equal(t.Resources.StagingClient.Properties.GenerateSecret, false);
  assert.equal(t.Parameters.Channel3SecretArn.Default, undefined);
  assert.equal(new RegExp(t.Parameters.Channel3SecretArn.AllowedPattern).test('arn:aws:secretsmanager:us-east-2:427064007352:secret:AnoX/Channel3/Production-22Xm3D'), false);
});
test('staging retains protections exact runtime source and private-to-staging invocation', () => {
  const t = buildStagingTemplate(), catalog = require('../backend/build-template.cjs').buildTemplate(require('node:fs').readFileSync(require('node:path').join(__dirname, '../backend/index.js'), 'utf8')), commerce = require('../backend/commerce/build-template.cjs').buildTemplate();
  assert.equal(t.Resources.Channel3Function.Properties.Code.ZipFile, catalog.Resources.Channel3Function.Properties.Code.ZipFile);
  assert.equal(t.Resources.CommerceFunction.Properties.Code.ZipFile, commerce.Resources.CommerceFunction.Properties.Code.ZipFile);
  for (const table of ['CatalogCache', 'CommerceTable']) { assert.equal(t.Resources[table].DeletionPolicy, 'Retain'); assert.equal(t.Resources[table].Properties.DeletionProtectionEnabled, true); assert.equal(t.Resources[table].Properties.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled, true); }
  assert.deepEqual(t.Resources.CommerceFunction.Properties.Environment.Variables.CATALOG_FUNCTION_ARN, { 'Fn::GetAtt': ['Channel3Function', 'Arn'] });
  assert.deepEqual(t.Resources.Channel3Function.Properties.Environment.Variables.METRIC_NAMESPACE, 'AnoX/Staging/Catalog');
  assert.equal(t.Resources.PaidUsageAlarm.Properties.Namespace, 'AnoX/Staging/Catalog');
  assert.equal(t.Resources.CommerceFailureAlarm.Properties.Namespace, 'AnoX/Staging/Commerce');
  for (const p of ['FreeSearchMonthlyCredits', 'PaidSearchMonthlyCredits', 'SearchDailyLimit', 'DetailMonthlyLimit', 'DetailDailyLimit']) assert.equal(t.Parameters[p].Default, 0);
  assert.equal(t.Parameters.ReservedConcurrency.Default, 2); assert.equal(t.Parameters.StagingCatalogConcurrency.Default, 3);
  assert.equal(t.Resources.CommerceFunction.Properties.Environment.Variables.ALLOWED_ORIGIN, 'https://anox.app');
});
test('staging routes all bind the isolated API and private routes use only staging JWT', () => {
  const t = buildStagingTemplate(), routes = Object.values(t.Resources).filter(r => r.Type === 'AWS::ApiGatewayV2::Route');
  assert.equal(routes.length, 9);
  for (const r of routes) { assert.deepEqual(r.Properties.ApiId, { Ref: 'StagingApi' }); if (r.Properties.AuthorizationType === 'JWT') assert.deepEqual(r.Properties.AuthorizerId, { Ref: 'StagingAuthorizer' }); }
  assert.equal(routes.filter(r => r.Properties.AuthorizationType === 'JWT').length, 6);
  assert.equal(routes.some(r => /webhook|^POST \/checkout/.test(r.Properties.RouteKey)), false);
});
test('acceptance planning never runs cloud operations or treats unchecked approval as evidence', () => {
  const p = prepareAcceptance(plan()); assert.equal(p.executed, false); assert.equal(p.authorizesDeployment, false); assert.equal(p.readyToExecute, false); assert.equal(p.requests.some(r => /webhook|^\/checkout$/.test(r.path)), false);
  assert.ok(p.blockers.includes('EXPLICIT_APPROVAL_REQUIRED'));
  assert.ok(p.requests.some(r => r.id === 'quote-foreign-owner'));
  assert.equal(p.secretsWritten, false);
});
test('acceptance planning rejects production targets credentials and unbounded budgets', () => {
  for (const mutate of [p => p.apiId = productionApi, p => p.account = '000000000000', p => p.stage = 'review', p => p.stackName = 'AnoX-Commerce', p => p.customerAliases = ['same', 'same'], p => p.token = 'do-not-store', p => p.budgets.awsRequests = Infinity, p => p.budgets.searchRequests = 100000, p => p.budgets.detailRequests = -1, p => p.approval.granted = 'true']) { const p = plan(); mutate(p); assert.throws(() => prepareAcceptance(p)); }
});
test('approved acceptance plan remains nonexecuting and bounds the total provider work', () => {
  const p = plan(); p.approval.granted = true; p.budgets.searchRequests = 3; p.budgets.detailRequests = 25;
  const r = prepareAcceptance(p); assert.equal(r.readyToExecute, true); assert.equal(r.executed, false); assert.equal(r.authorizesPayments, false);
  assert.equal(r.providerAttemptUpperBound.search, 3); assert.equal(r.providerAttemptUpperBound.detail, 25);
  assert.ok(r.requests.every(r => r.classification === 'AWS integration' || r.classification === 'Real provider read'));
});
test('staging Cognito permits the canonical frontend login flow', () => {
  const t = buildStagingTemplate();
  const auth = require('node:fs').readFileSync(require('node:path').join(__dirname, '../auth.js'), 'utf8');
  assert.ok(auth.includes("AuthFlow:'USER_PASSWORD_AUTH'"));
  assert.ok(t.Resources.StagingClient.Properties.ExplicitAuthFlows.includes('ALLOW_USER_PASSWORD_AUTH'));
});
test('acceptance identities have a defined mapping and unknown-price schema uses actual status', () => {
  const p = plan(), r = prepareAcceptance(p);
  assert.equal(r.requests.find(r => r.id === 'quote-schema').expectedStatus, 400);
  p.customerAliases = ['alice', 'bob']; assert.throws(() => prepareAcceptance(p));
});
test('planned unknown-price rejection agrees with the real commerce handler', async () => {
  const { createHandler } = require('../backend/commerce/index.js');
  const { MemoryStore, FIXED_NOW, requestBody, event, config } = require('./helpers/commerce.cjs');
  let reads = 0;
  const handler = createHandler({ store: new MemoryStore(), catalog: { freshProduct: async () => { reads++; throw Error('must not read'); } }, now: () => FIXED_NOW, config, logger: { info() {}, error() {} } });
  const body = requestBody(); body.lines[0].unitPriceMinor = 1;
  const response = await handler(event('POST', '/commerce/quotes', body));
  assert.equal(response.statusCode, prepareAcceptance(plan()).requests.find(r => r.id === 'quote-schema').expectedStatus);
  assert.equal(reads, 0);
});
