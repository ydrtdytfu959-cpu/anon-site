'use strict';
const { createHandler } = require('./index.js');
const { createDynamoStore } = require('./store.js');
function loadSdk() {
  return { ...require('@aws-sdk/client-dynamodb'), ...require('@aws-sdk/lib-dynamodb'), ...require('@aws-sdk/client-lambda') };
}
function createRuntime({ env = process.env, sdk, logger = console } = {}) {
  const region = env.AWS_REGION || 'us-east-2';
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(region) || !/^[A-Za-z0-9_.-]{3,255}$/.test(env.COMMERCE_TABLE || '') || !/^arn:aws:lambda:[a-z0-9-]+:\d{12}:function:[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)?$/.test(env.CATALOG_FUNCTION_ARN || '') || !/^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9-]+_[A-Za-z0-9]+$/.test(env.COGNITO_ISSUER || '') || !/^[A-Za-z0-9_-]{1,128}$/.test(env.COGNITO_CLIENT_ID || '') || (env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== 'https://anox.app')) throw Error('Commerce runtime configuration is incomplete.');
  sdk ||= loadSdk();
  const database = sdk.DynamoDBDocumentClient.from(new sdk.DynamoDBClient({ region, maxAttempts: 2, requestHandler: { connectionTimeout: 500, requestTimeout: 1500 } }), { marshallOptions: { removeUndefinedValues: false } });
  const lambda = new sdk.LambdaClient({ region, maxAttempts: 1, requestHandler: { connectionTimeout: 500, requestTimeout: 9000 } });
  const commands = { Get: sdk.GetCommand, Put: sdk.PutCommand, Update: sdk.UpdateCommand, Query: sdk.QueryCommand, TransactWrite: sdk.TransactWriteCommand };
  const store = createDynamoStore({ tableName: env.COMMERCE_TABLE, send: (operation, input) => {
    const Command = commands[operation]; if (!Command) throw Error('Unsupported persistence operation.');
    return database.send(new Command(input), { abortSignal: AbortSignal.timeout(1500) });
  } });
  const catalog = { freshProduct: async ({ productId, options }, { signal }) => {
    const response = await lambda.send(new sdk.InvokeCommand({ FunctionName: env.CATALOG_FUNCTION_ARN, InvocationType: 'RequestResponse', Payload: Buffer.from(JSON.stringify({ operation: 'commerce.product', productId, options })) }), { abortSignal: signal });
    if (response.FunctionError || !response.Payload || response.Payload.byteLength > 512000) throw Error('Fresh catalog response unavailable.');
    return JSON.parse(Buffer.from(response.Payload).toString('utf8'));
  } };
  return { store, catalog, handler: createHandler({ store, catalog, logger, config: { issuer: env.COGNITO_ISSUER, clientId: env.COGNITO_CLIENT_ID, allowedOrigin: env.ALLOWED_ORIGIN || 'https://anox.app' } }) };
}
let runtime;
async function handler(event) {
  try { runtime ||= createRuntime(); return await runtime.handler(event); }
  catch { console.error(JSON.stringify({ service: 'commerce', outcome: 'runtime_unavailable', statusCode: 503 })); return { statusCode: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, body: JSON.stringify({ schemaVersion: 1, error: { code: 'service_unavailable', message: 'Commerce is temporarily unavailable.' } }) }; }
}
module.exports = { createRuntime, handler };
