const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createRuntime } = require('../backend/commerce/runtime.js');
const { bundleSource } = require('../backend/commerce/build-template.cjs');
const { freshProduct, config } = require('./helpers/commerce.cjs');
function sdkFixture(invoke = async () => ({ Payload: Buffer.from(JSON.stringify(freshProduct())) })) {
  const calls = [], configs = [];
  class DynamoDBClient { constructor(configuration) { configs.push({ kind: 'dynamo', configuration }); } }
  class LambdaClient { constructor(configuration) { configs.push({ kind: 'lambda', configuration }); } async send(command, options) { calls.push({ kind: 'lambda', command, options }); return invoke(command, options); } }
  const DynamoDBDocumentClient = { from() { return { send: async (command, options) => { calls.push({ kind: 'dynamo', command, options }); return {}; } }; } };
  const sdk = { DynamoDBClient, LambdaClient, DynamoDBDocumentClient };
  for (const name of ['GetCommand', 'PutCommand', 'UpdateCommand', 'QueryCommand', 'TransactWriteCommand', 'InvokeCommand']) sdk[name] = class { constructor(input) { this.input = input; this.name = name; } };
  return { sdk, calls, configs };
}
const env = { AWS_REGION: 'us-east-2', COMMERCE_TABLE: 'commerce-test', CATALOG_FUNCTION_ARN: 'arn:aws:lambda:us-east-2:427064007352:function:AnoX-Channel3-Catalog', COGNITO_ISSUER: config.issuer, COGNITO_CLIENT_ID: config.clientId, ALLOWED_ORIGIN: config.allowedOrigin };
test('runtime invokes only the configured IAM catalog function and passes abort signals', async () => {
  const fake = sdkFixture(), runtime = createRuntime({ env, sdk: fake.sdk, logger: { info() {}, error() {} } }), controller = new AbortController();
  const result = await runtime.catalog.freshProduct({ productId: 'product1', options: { Size: 'M' } }, { signal: controller.signal });
  assert.equal(result.status, 'fresh'); const invocation = fake.calls[0];
  assert.equal(invocation.command.input.FunctionName, env.CATALOG_FUNCTION_ARN); assert.equal(invocation.command.input.InvocationType, 'RequestResponse');
  assert.deepEqual(JSON.parse(invocation.command.input.Payload), { operation: 'commerce.product', productId: 'product1', options: { Size: 'M' } });
  assert.equal(invocation.options.abortSignal, controller.signal); assert.equal(fake.configs.find(x => x.kind === 'lambda').configuration.maxAttempts, 1);
});
test('runtime bounds Dynamo operations and maps document SDK commands without a scan or secret client', async () => {
  const fake = sdkFixture(), runtime = createRuntime({ env, sdk: fake.sdk });
  await runtime.store.get('alice', 'order', 'order1');
  assert.equal(fake.calls[0].command.name, 'GetCommand'); assert.equal(fake.calls[0].command.input.TableName, env.COMMERCE_TABLE); assert.ok(fake.calls[0].options.abortSignal instanceof AbortSignal);
  assert.equal(fake.configs.find(x => x.kind === 'dynamo').configuration.maxAttempts, 2);
});
test('runtime rejects missing configuration and cannot be pointed to a URL instead of a Lambda ARN', () => {
  const fake = sdkFixture(); assert.throws(() => createRuntime({ env: {}, sdk: fake.sdk }));
  assert.throws(() => createRuntime({ env: { ...env, CATALOG_FUNCTION_ARN: 'https://evil.example' }, sdk: fake.sdk }));
});
test('runtime rejects failed, absent, oversized and malformed catalog results without writing persistence', async () => {
  for (const response of [
    { FunctionError: 'Unhandled', Payload: Buffer.from('{"diagnostic":"internal-only"}') },
    {}, { Payload: Buffer.alloc(512001) }, { Payload: Buffer.from('{malformed') }
  ]) {
    const fake = sdkFixture(async () => response), runtime = createRuntime({ env, sdk: fake.sdk });
    await assert.rejects(runtime.catalog.freshProduct({ productId: 'product1', options: {} }, { signal: AbortSignal.timeout(1000) }));
    assert.deepEqual(fake.calls.map(call => call.kind), ['lambda']);
  }
});
test('runtime propagates transport cancellation without retrying the catalog', async () => {
  const controller = new AbortController(); controller.abort();
  const fake = sdkFixture(async (_command, { abortSignal }) => { abortSignal.throwIfAborted(); });
  const runtime = createRuntime({ env, sdk: fake.sdk });
  await assert.rejects(runtime.catalog.freshProduct({ productId: 'product1', options: {} }, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(fake.calls.length, 1);
});
test('generated Lambda bundle boots with runtime SDK modules and preserves public capability behavior', async () => {
  const fake = sdkFixture(), context = {
    exports: {}, process: { env }, Buffer, AbortSignal, console: { error() {} },
    require(name) {
      if (['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb', '@aws-sdk/client-lambda'].includes(name)) return fake.sdk;
      if (name.startsWith('node:')) return require(name);
      throw Error('Unbundled local module: ' + name);
    }
  };
  vm.runInNewContext(bundleSource(), context);
  const response = await context.exports.handler({ version: '2.0', rawPath: '/commerce/capabilities', headers: { origin: 'https://anox.app' }, requestContext: { http: { method: 'GET' } } });
  assert.equal(response.statusCode, 200); assert.equal(JSON.parse(response.body).checkout.enabled, false);
  assert.equal(response.headers['Cache-Control'], 'no-store'); assert.equal(fake.calls.length, 0);
});
