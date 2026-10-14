const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { generatedTemplate, bundleSource } = require('../backend/commerce/build-template.cjs');
const file = path.join(__dirname, '../backend/commerce/cloudformation.json');
test('commerce template and inline runtime are reproducible and syntactically valid', () => {
  assert.equal(fs.readFileSync(file, 'utf8'), generatedTemplate()); const template = JSON.parse(generatedTemplate());
  assert.equal(template.Resources.CommerceFunction.Properties.Code.ZipFile, bundleSource()); new vm.Script(bundleSource());
  assert.ok(Buffer.byteLength(generatedTemplate()) < 1024 * 1024);
});
test('new commerce stack preserves the existing API and Cognito authorizer ownership', () => {
  const template = JSON.parse(generatedTemplate()), resources = Object.values(template.Resources);
  assert.equal(resources.some(r => ['AWS::ApiGatewayV2::Api', 'AWS::ApiGatewayV2::Stage', 'AWS::Cognito::UserPool', 'AWS::Cognito::UserPoolClient', 'AWS::ApiGatewayV2::Authorizer'].includes(r.Type)), false);
  const routes = resources.filter(r => r.Type === 'AWS::ApiGatewayV2::Route'); assert.equal(routes.length, 7);
  for (const route of routes) { assert.match(route.Properties.RouteKey, / \/commerce\//); assert.equal(route.Properties.AuthorizationType, route.Properties.RouteKey === 'GET /commerce/capabilities' ? 'NONE' : 'JWT'); if (route.Properties.AuthorizationType === 'JWT') assert.deepEqual(route.Properties.AuthorizerId, { Ref: 'ExistingAuthorizerId' }); }
  assert.equal(routes.some(r => /webhook/.test(r.Properties.RouteKey)), false); assert.equal(template.Parameters.CognitoIssuer.Default, undefined);
});
test('persistent commerce state retains data with encryption recovery and TTL cleanup', () => {
  const resource = JSON.parse(generatedTemplate()).Resources.CommerceTable;
  assert.equal(resource.DeletionPolicy, 'Retain'); assert.equal(resource.UpdateReplacePolicy, 'Retain'); assert.equal(resource.Properties.SSESpecification.SSEEnabled, true); assert.equal(resource.Properties.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled, true); assert.equal(resource.Properties.DeletionProtectionEnabled, true); assert.equal(resource.Properties.TimeToLiveSpecification.AttributeName, 'ttl');
});
test('commerce role is scoped to its table logs and one catalog Lambda, with no payment or secret permission', () => {
  const template = JSON.parse(generatedTemplate()), statements = template.Resources.CommerceRole.Properties.Policies[0].PolicyDocument.Statement;
  assert.equal(statements.some(s => s.Resource === '*'), false);
  assert.equal(statements.some(s => JSON.stringify(s.Action).match(/secretsmanager|stripe|Scan|DeleteItem|dynamodb:\*/)), false);
  const invoke = statements.find(s => s.Action.includes('lambda:InvokeFunction')); assert.deepEqual(invoke.Resource, { Ref: 'CatalogFunctionArn' });
  const permissions = Object.values(template.Resources).filter(r => r.Type === 'AWS::Lambda::Permission'); assert.equal(permissions.length, 7); assert.ok(permissions.every(p => JSON.stringify(p.Properties.SourceArn).includes('/commerce/')));
});
test('commerce infrastructure bounds compute and has failure throttle latency and cost-usage alarms', () => {
  const template = JSON.parse(generatedTemplate()), fn = template.Resources.CommerceFunction.Properties;
  assert.equal(fn.Runtime, 'nodejs24.x'); assert.equal(fn.Timeout, 18); assert.ok(fn.ReservedConcurrentExecutions); assert.ok(template.Resources.CommerceLogs.Properties.RetentionInDays >= 30);
  for (const name of ['CommerceFailureAlarm', 'CommerceThrottleAlarm', 'CommerceDurationAlarm', 'CommerceWriteUsageAlarm']) assert.equal(template.Resources[name].Type, 'AWS::CloudWatch::Alarm');
  assert.equal(JSON.stringify(fn.Environment).includes('CHECKOUT_ENABLED'), false);
});
