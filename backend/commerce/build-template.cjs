'use strict';
const fs = require('node:fs');
const path = require('node:path');
const MODULES = ['errors.js', 'money.js', 'validation.js', 'providers.js', 'delivery.js', 'quote.js', 'orders.js', 'index.js', 'store.js', 'webhooks.js', 'runtime.js'];
function bundleSource() {
  const modules = MODULES.map(name => JSON.stringify('./' + name) + ':function(module,exports,require){\n' + fs.readFileSync(path.join(__dirname, name), 'utf8') + '\n}').join(',\n');
  return "'use strict';\nconst externalRequire=require;\nconst factories={\n" + modules + "\n};\nconst loaded=Object.create(null);\nfunction load(name){if(!Object.hasOwn(factories,name))return externalRequire(name);if(loaded[name])return loaded[name].exports;const module={exports:{}};loaded[name]=module;factories[name](module,module.exports,load);return module.exports;}\nexports.handler=load('./runtime.js').handler;\n";
}
const ref = name => ({ Ref: name });
const get = (name, attribute) => ({ 'Fn::GetAtt': [name, attribute] });
const sub = value => ({ 'Fn::Sub': value });
function buildTemplate(source = bundleSource()) {
  const notification = { 'Fn::If': ['HasAlarmTopic', [ref('ExistingAlarmTopicArn')], ref('AWS::NoValue')] };
  const lambdaAlarm = (metric, statistic, threshold, description) => ({ Type: 'AWS::CloudWatch::Alarm', Properties: { AlarmDescription: description, Namespace: 'AWS/Lambda', MetricName: metric, Dimensions: [{ Name: 'FunctionName', Value: ref('CommerceFunction') }], [statistic === 'p99' ? 'ExtendedStatistic' : 'Statistic']: statistic, Period: 300, EvaluationPeriods: 1, Threshold: threshold, ComparisonOperator: 'GreaterThanOrEqualToThreshold', TreatMissingData: 'notBreaching', AlarmActions: notification } });
  const resources = {
    CommerceTable: { Type: 'AWS::DynamoDB::Table', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: { BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' }], KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }], SSESpecification: { SSEEnabled: true }, PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true }, DeletionProtectionEnabled: true, TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true }, Tags: [{ Key: 'Service', Value: 'AnoX-Commerce' }] } },
    CommerceLogs: { Type: 'AWS::Logs::LogGroup', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: { LogGroupName: sub('/aws/lambda/${AWS::StackName}-commerce'), RetentionInDays: 90 } },
    CommerceRole: { Type: 'AWS::IAM::Role', Properties: { AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] }, Policies: [{ PolicyName: 'CommerceRuntime', PolicyDocument: { Version: '2012-10-17', Statement: [
      { Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query', 'dynamodb:ConditionCheckItem'], Resource: get('CommerceTable', 'Arn') },
      { Effect: 'Allow', Action: ['lambda:InvokeFunction'], Resource: ref('CatalogFunctionArn') },
      { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${AWS::StackName}-commerce:*') }
    ] } }] } },
    CommerceFunction: { Type: 'AWS::Lambda::Function', DependsOn: ['CommerceLogs'], Properties: { FunctionName: sub('${AWS::StackName}-commerce'), Runtime: 'nodejs24.x', Handler: 'index.handler', Timeout: 18, MemorySize: 256, ReservedConcurrentExecutions: ref('ReservedConcurrency'), Role: get('CommerceRole', 'Arn'), Environment: { Variables: { COMMERCE_TABLE: ref('CommerceTable'), CATALOG_FUNCTION_ARN: ref('CatalogFunctionArn'), COGNITO_ISSUER: ref('CognitoIssuer'), COGNITO_CLIENT_ID: ref('CognitoClientId'), ALLOWED_ORIGIN: 'https://anox.app' } }, Code: { ZipFile: source } } },
    CommerceIntegration: { Type: 'AWS::ApiGatewayV2::Integration', Properties: { ApiId: ref('ExistingHttpApiId'), IntegrationType: 'AWS_PROXY', IntegrationMethod: 'POST', PayloadFormatVersion: '2.0', TimeoutInMillis: 20000, IntegrationUri: get('CommerceFunction', 'Arn') } },
    CommerceFailureMetric: { Type: 'AWS::Logs::MetricFilter', Properties: { LogGroupName: ref('CommerceLogs'), FilterPattern: '?catalog_unavailable ?service_unavailable ?runtime_unavailable', MetricTransformations: [{ MetricNamespace: 'AnoX/Commerce', MetricName: 'ServiceUnavailable', MetricValue: '1', DefaultValue: 0 }] } },
    CommerceFailureAlarm: { Type: 'AWS::CloudWatch::Alarm', Properties: { AlarmDescription: 'The commerce handler is returning unavailable responses. No customer data is included.', Namespace: 'AnoX/Commerce', MetricName: 'ServiceUnavailable', Statistic: 'Sum', Period: 300, EvaluationPeriods: 1, Threshold: 3, ComparisonOperator: 'GreaterThanOrEqualToThreshold', TreatMissingData: 'notBreaching', AlarmActions: notification } },
    CommerceRuntimeErrorAlarm: lambdaAlarm('Errors', 'Sum', 1, 'An unhandled commerce Lambda error occurred.'),
    CommerceThrottleAlarm: lambdaAlarm('Throttles', 'Sum', 1, 'Commerce reserved concurrency is exhausted.'),
    CommerceDurationAlarm: lambdaAlarm('Duration', 'p99', 14000, 'Commerce p99 duration approaches its 18-second runtime limit.'),
    CommerceWriteUsageAlarm: { Type: 'AWS::CloudWatch::Alarm', Properties: { AlarmDescription: 'Commerce write consumption reaches 10,000 capacity units per hour. This is a usage alert, not a provider invoice.', Namespace: 'AWS/DynamoDB', MetricName: 'ConsumedWriteCapacityUnits', Dimensions: [{ Name: 'TableName', Value: ref('CommerceTable') }], Statistic: 'Sum', Period: 3600, EvaluationPeriods: 1, Threshold: 10000, ComparisonOperator: 'GreaterThanOrEqualToThreshold', TreatMissingData: 'notBreaching', AlarmActions: notification } },
    CommerceTableThrottleAlarm: { Type: 'AWS::CloudWatch::Alarm', Properties: { AlarmDescription: 'Commerce DynamoDB requests were throttled.', Namespace: 'AWS/DynamoDB', MetricName: 'WriteThrottleEvents', Dimensions: [{ Name: 'TableName', Value: ref('CommerceTable') }], Statistic: 'Sum', Period: 300, EvaluationPeriods: 1, Threshold: 1, ComparisonOperator: 'GreaterThanOrEqualToThreshold', TreatMissingData: 'notBreaching', AlarmActions: notification } }
  };
  const routes = [ ['Capabilities', 'GET', 'capabilities', false], ['Quotes', 'POST', 'quotes', true], ['Attempts', 'POST', 'checkout-attempts', true], ['Orders', 'GET', 'orders', true], ['Order', 'GET', 'orders/{orderId}', true], ['Cancel', 'POST', 'orders/{orderId}/cancel', true], ['Refund', 'POST', 'orders/{orderId}/refund', true] ];
  for (const [name, method, route, authenticated] of routes) {
    resources[name + 'Route'] = { Type: 'AWS::ApiGatewayV2::Route', Properties: { ApiId: ref('ExistingHttpApiId'), RouteKey: method + ' /commerce/' + route, AuthorizationType: authenticated ? 'JWT' : 'NONE', ...(authenticated ? { AuthorizerId: ref('ExistingAuthorizerId') } : {}), Target: { 'Fn::Join': ['/', ['integrations', ref('CommerceIntegration')]] } } };
    resources[name + 'Permission'] = { Type: 'AWS::Lambda::Permission', Properties: { Action: 'lambda:InvokeFunction', FunctionName: ref('CommerceFunction'), Principal: 'apigateway.amazonaws.com', SourceAccount: ref('AWS::AccountId'), SourceArn: sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${ExistingHttpApiId}/*/' + method + '/commerce/' + route.replace('{orderId}', '*')) } };
  }
  return { AWSTemplateFormatVersion: '2010-09-09', Description: 'Staged AnoX commerce quotes, blocked checkout attempts and owned order foundation. No merchant orders, payments or webhook route.', Parameters: {
    ExistingHttpApiId: { Type: 'String', Default: 'zmumi2wruk', AllowedPattern: '^[a-z0-9]{10}$', Description: 'Existing HTTP API; verify in us-east-2 before deployment. This stack owns only its new /commerce routes.' },
    ExistingAuthorizerId: { Type: 'String', AllowedPattern: '^[a-z0-9]{1,32}$', Description: 'Existing Cognito JWT authorizer ID; read and verify issuer/audience before deployment.' },
    CognitoIssuer: { Type: 'String', AllowedPattern: '^https://cognito-idp\\.us-east-2\\.amazonaws\\.com/us-east-2_[A-Za-z0-9]+$', Description: 'Verified existing Cognito issuer URL; deliberately no guessed default.' },
    CognitoClientId: { Type: 'String', Default: '63738r9gpr126qpgp1a5cubchi', AllowedPattern: '^[a-z0-9]{1,128}$', Description: 'Existing frontend Cognito app client; must match the JWT authorizer audience.' },
    CatalogFunctionArn: { Type: 'String', Default: 'arn:aws:lambda:us-east-2:427064007352:function:AnoX-Channel3-Catalog', AllowedPattern: '^arn:aws:lambda:us-east-2:427064007352:function:AnoX-Channel3-Catalog(?::[A-Za-z0-9_-]+)?$', Description: 'Existing catalog Lambda with the reviewed IAM-only commerce.product handler deployed first.' },
    ReservedConcurrency: { Type: 'Number', Default: 2, MinValue: 1, MaxValue: 5, Description: 'Bounds downstream pressure; account concurrency quota must be checked.' },
    ExistingAlarmTopicArn: { Type: 'String', Default: '', AllowedPattern: '^(|arn:aws:sns:us-east-2:427064007352:[A-Za-z0-9_-]{1,256})$', Description: 'Optional existing authorized SNS alarm topic. Empty creates alarms without notifications.' }
  }, Conditions: { HasAlarmTopic: { 'Fn::Not': [{ 'Fn::Equals': [ref('ExistingAlarmTopicArn'), ''] }] } }, Resources: resources, Outputs: { CommerceFunctionArn: { Value: get('CommerceFunction', 'Arn') }, CommerceTableName: { Value: ref('CommerceTable') }, CommerceLogGroup: { Value: ref('CommerceLogs') } } };
}
function generatedTemplate() {
  const output = JSON.stringify(buildTemplate(), null, 2) + '\n';
  if (Buffer.byteLength(output) > 1024 * 1024) throw Error('Commerce template exceeds CloudFormation S3 template limit.');
  return output;
}
if (require.main === module) {
  const file = path.join(__dirname, 'cloudformation.json'), output = generatedTemplate();
  if (process.argv.includes('--check')) { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== output) throw Error('Commerce template differs from source.'); }
  else fs.writeFileSync(file, output);
}
module.exports = { buildTemplate, generatedTemplate, bundleSource };
