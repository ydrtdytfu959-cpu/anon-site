'use strict';
const fs = require('node:fs');
const path = require('node:path');
function buildTemplate(source) {
  const alarm = (metric, period, threshold, description) => ({Type:'AWS::CloudWatch::Alarm', Properties:{AlarmDescription:description, Namespace:'AnoX/Catalog', MetricName:metric,
    Dimensions:[{Name:'Service', Value:'Channel3Catalog'}], Statistic:'Sum', Period:period, EvaluationPeriods:1, Threshold:threshold, ComparisonOperator:'GreaterThanOrEqualToThreshold',
    TreatMissingData:'notBreaching', AlarmActions:{'Fn::If':['HasAlarmTopic', [{Ref:'ExistingAlarmTopicArn'}], {Ref:'AWS::NoValue'}]}}});
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'AnoX Channel3 catalog and fresh product details with scoped credentials, expiring caches, atomic upstream budgets and alarms.',
    Parameters: {
      Channel3SecretArn: {
        Type: 'String',
        Description: 'Existing Channel3 secret ARN; only the deployed Lambda resolves its value.',
        Default: 'arn:aws:secretsmanager:us-east-2:427064007352:secret:AnoX/Channel3/Production-22Xm3D',
        AllowedPattern: '^arn:aws:secretsmanager:us-east-2:427064007352:secret:AnoX/Channel3/Production-[A-Za-z0-9]{6}$'
      },
      ExistingHttpApiId:{Type:'String', Default:'zmumi2wruk', AllowedPattern:'^[a-z0-9]{10}$', Description:'Existing HTTP API. Adds only the dedicated Channel3 detail route; existing routes remain owned by their stacks.'},
      PaidDailyLimit:{Type:'Number', Default:1000, MinValue:0, MaxValue:10000, Description:'Maximum paid search attempts per UTC day. Zero disables new upstream searches; cached pages remain readable.'},
      DetailDailyLimit:{Type:'Number', Default:5000, MinValue:0, MaxValue:10000, Description:'Maximum free detail attempts per UTC day. Confirm account shared quota before increasing either daily limit.'},
      UpstreamPerSecondLimit:{Type:'Number', Default:5, MinValue:1, MaxValue:10, Description:'Shared fixed-window request cap per second across search and detail.'},
      ExistingAlarmTopicArn:{Type:'String', Default:'', AllowedPattern:'^(|arn:[a-z0-9-]+:sns:[a-z0-9-]+:[0-9]{12}:[A-Za-z0-9_-]{1,256})$', Description:'Optional existing standard SNS topic authorized to receive CloudWatch alarms. Empty creates visible alarms without notifications.'}
    },
    Conditions:{HasAlarmTopic:{'Fn::Not':[{'Fn::Equals':[{Ref:'ExistingAlarmTopicArn'}, '']}] }},
    Resources: {
      CatalogCache: {
        Type: 'AWS::DynamoDB::Table', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain',
        Properties: {
          BillingMode: 'PAY_PER_REQUEST',
          AttributeDefinitions: [{AttributeName: 'pk', AttributeType: 'S'}],
          KeySchema: [{AttributeName: 'pk', KeyType: 'HASH'}],
          TimeToLiveSpecification: {AttributeName: 'expiresAt', Enabled: true},
          SSESpecification: {SSEEnabled: true},
          Tags: [{Key: 'Service', Value: 'AnoX-Channel3-Catalog'}]
        }
      },
      Channel3Role: {
        Type: 'AWS::IAM::Role',
        Properties: {
          AssumeRolePolicyDocument: {Version: '2012-10-17', Statement: [{Effect: 'Allow', Principal: {Service: 'lambda.amazonaws.com'}, Action: 'sts:AssumeRole'}]},
          Policies: [{PolicyName: 'Channel3CatalogRuntime', PolicyDocument: {Version: '2012-10-17', Statement: [
            {Effect: 'Allow', Action: ['secretsmanager:GetSecretValue'], Resource: {Ref: 'Channel3SecretArn'}},
            {Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:DeleteItem', 'dynamodb:UpdateItem'], Resource: {'Fn::GetAtt': ['CatalogCache', 'Arn']}},
            {Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: {'Fn::Sub': 'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/AnoX-Channel3-Catalog:*'}}
          ]}}]
        }
      },
      Channel3Function: {
        Type: 'AWS::Lambda::Function',
        Properties: {
          // Preserve the existing logical and physical names: API Gateway's current
          // integration and invocation permission continue targeting the same ARN.
          FunctionName: 'AnoX-Channel3-Catalog', Runtime: 'nodejs24.x', Handler: 'index.handler', Timeout: 20, MemorySize: 256,
          Role: {'Fn::GetAtt': ['Channel3Role', 'Arn']},
          Environment: {Variables: {CHANNEL3_SECRET_ID: {Ref: 'Channel3SecretArn'}, CACHE_TABLE: {Ref: 'CatalogCache'}, PAID_DAILY_LIMIT:{Ref:'PaidDailyLimit'}, DETAIL_DAILY_LIMIT:{Ref:'DetailDailyLimit'}, UPSTREAM_PER_SECOND_LIMIT:{Ref:'UpstreamPerSecondLimit'}}},
          Code: {ZipFile: source}
        }
      },
      DetailIntegration:{Type:'AWS::ApiGatewayV2::Integration', Properties:{ApiId:{Ref:'ExistingHttpApiId'}, IntegrationType:'AWS_PROXY', IntegrationMethod:'POST', PayloadFormatVersion:'2.0', TimeoutInMillis:20000, IntegrationUri:{'Fn::GetAtt':['Channel3Function', 'Arn']}}},
      DetailRoute:{Type:'AWS::ApiGatewayV2::Route', Properties:{ApiId:{Ref:'ExistingHttpApiId'}, RouteKey:'GET /catalog/channel3/products/{id}', AuthorizationType:'NONE', Target:{'Fn::Join':['/', ['integrations', {Ref:'DetailIntegration'}]]}}},
      DetailPermission:{Type:'AWS::Lambda::Permission', Properties:{Action:'lambda:InvokeFunction', FunctionName:{Ref:'Channel3Function'}, Principal:'apigateway.amazonaws.com', SourceAccount:{Ref:'AWS::AccountId'}, SourceArn:{'Fn::Sub':'arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${ExistingHttpApiId}/*/GET/catalog/channel3/products/*'}}},
      PaidUsageAlarm:alarm('paid_search_request', 86400, {Ref:'PaidDailyLimit'}, 'Paid search HTTP attempts reach the configured daily budget. Count measures attempted requests, not settled provider billing.'),
      DetailUsageAlarm:alarm('free_detail_request', 86400, {Ref:'DetailDailyLimit'}, 'Free detail attempts reach the configured quota budget.'),
      BudgetDeniedAlarm:alarm('budget_exceeded', 300, 1, 'The distributed daily upstream budget denied a request.'),
      UpstreamFailureAlarm:alarm('upstream_failure', 300, 5, 'Channel3 catalog or detail retrieval is failing.'),
      BudgetStorageAlarm:alarm('budget_error', 300, 1, 'The budget counter could not be reserved; upstream calls fail closed.')
    },
    Outputs: {
      FunctionName: {Description: 'Existing catalog Lambda function name.', Value: {Ref: 'Channel3Function'}},
      CacheTableName: {Description: 'Expiring Channel3 cache table; independent from CJ products.', Value: {Ref: 'CatalogCache'}},
      FunctionArn:{Description:'IAM-only fresh detail invocation target for the separate commerce runtime.', Value:{'Fn::GetAtt':['Channel3Function', 'Arn']}}
    }
  };
}
function generatedTemplate() {
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const output = JSON.stringify(buildTemplate(source), null, 2) + '\n';
  // TemplateBody is limited to 51,200 bytes. Larger templates require an operator-
  // approved private S3 TemplateURL; the template itself may be up to 1 MiB.
  if (Buffer.byteLength(output) > 1024 * 1024) throw Error('Template exceeds CloudFormation S3 template size');
  return output;
}
if (require.main === module) {
  const file = path.join(__dirname, 'cloudformation.json'), output = generatedTemplate();
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== output) throw Error('Generated CloudFormation template differs from backend source');
  } else fs.writeFileSync(file, output);
}
module.exports = {buildTemplate};
