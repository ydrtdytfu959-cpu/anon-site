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
      BudgetMonth:{Type:'String', Default:'', AllowedPattern:'^(|20[0-9]{2}-(0[1-9]|1[0-2]))$', Description:'Explicit UTC allocation month YYYY-MM; empty or elapsed month disables upstream calls. Renew only after provider usage and other consumers are reconciled.'},
      NextBudgetMonth:{Type:'String', Default:'', AllowedPattern:'^(|20[0-9]{2}-(0[1-9]|1[0-2]))$', Description:'Optional, explicitly approved immediate successor to BudgetMonth, using the same caps. Set only after verifying provider allocation for that month and reconciling other consumers. Never advances automatically.'},
      FreeSearchMonthlyCredits:{Type:'Number', Default:0, MinValue:0, MaxValue:1000, Description:'Verified remaining monthly free search credits allocated to this service, not the provider account balance. Default zero.'},
      PaidUsageEnabled:{Type:'String', Default:'false', AllowedValues:['false','true'], Description:'Explicit opt-in for separately approved paid search credits; does not allocate credits by itself.'},
      PaidSearchMonthlyCredits:{Type:'Number', Default:0, MinValue:0, MaxValue:1000000, Description:'Explicit paid search credit allocation for BudgetMonth, requires PaidUsageEnabled=true. Zero by default; no automatic renewal.'},
      SearchDailyLimit:{Type:'Number', Default:0, MinValue:0, MaxValue:10000, Description:'Search request attempts per UTC day within the approved monthly allocation. Zero disables new upstream searches, not cached pages.'},
      DetailMonthlyLimit:{Type:'Number', Default:0, MinValue:0, MaxValue:310000, Description:'Explicit product-detail request allocation for BudgetMonth; product retrieval currently has zero listed credit cost, but consumes account request quota.'},
      DetailDailyLimit:{Type:'Number', Default:0, MinValue:0, MaxValue:10000, Description:'Product-detail attempts per UTC day within the monthly request allocation. Zero disables new detail requests.'},
      TotalDailyLimit:{Type:'Number', Default:1000, MinValue:0, MaxValue:10000, Description:'Shared daily request cap across both classes; not the provider free monthly allowance or a paid spending allocation.'},
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
          DeletionProtectionEnabled: true, PointInTimeRecoverySpecification: {PointInTimeRecoveryEnabled: true},
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
          Environment: {Variables: {CHANNEL3_SECRET_ID: {Ref: 'Channel3SecretArn'}, CACHE_TABLE: {Ref: 'CatalogCache'}, BUDGET_MONTH:{Ref:'BudgetMonth'}, NEXT_BUDGET_MONTH:{Ref:'NextBudgetMonth'}, FREE_SEARCH_MONTHLY_CREDITS:{Ref:'FreeSearchMonthlyCredits'}, PAID_USAGE_ENABLED:{Ref:'PaidUsageEnabled'}, PAID_SEARCH_MONTHLY_CREDITS:{Ref:'PaidSearchMonthlyCredits'}, SEARCH_DAILY_LIMIT:{Ref:'SearchDailyLimit'}, DETAIL_MONTHLY_LIMIT:{Ref:'DetailMonthlyLimit'}, DETAIL_DAILY_LIMIT:{Ref:'DetailDailyLimit'}, TOTAL_DAILY_LIMIT:{Ref:'TotalDailyLimit'}, UPSTREAM_PER_SECOND_LIMIT:{Ref:'UpstreamPerSecondLimit'}}},
          Code: {ZipFile: source}
        }
      },
      DetailIntegration:{Type:'AWS::ApiGatewayV2::Integration', Properties:{ApiId:{Ref:'ExistingHttpApiId'}, IntegrationType:'AWS_PROXY', IntegrationMethod:'POST', PayloadFormatVersion:'2.0', TimeoutInMillis:20000, IntegrationUri:{'Fn::GetAtt':['Channel3Function', 'Arn']}}},
      DetailRoute:{Type:'AWS::ApiGatewayV2::Route', Properties:{ApiId:{Ref:'ExistingHttpApiId'}, RouteKey:'GET /catalog/channel3/products/{id}', AuthorizationType:'NONE', Target:{'Fn::Join':['/', ['integrations', {Ref:'DetailIntegration'}]]}}},
      DetailPermission:{Type:'AWS::Lambda::Permission', Properties:{Action:'lambda:InvokeFunction', FunctionName:{Ref:'Channel3Function'}, Principal:'apigateway.amazonaws.com', SourceAccount:{Ref:'AWS::AccountId'}, SourceArn:{'Fn::Sub':'arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${ExistingHttpApiId}/*/GET/catalog/channel3/products/*'}}},
      BudgetMonitorSchedule:{Type:'AWS::Events::Rule', Properties:{Description:'Checks explicit month approval without reading credentials, counters or provider APIs.', ScheduleExpression:'rate(1 hour)', State:'ENABLED', Targets:[{Id:'BudgetStatus', Arn:{'Fn::GetAtt':['Channel3Function','Arn']}, Input:JSON.stringify({operation:'budget-status'})}]}},
      BudgetMonitorPermission:{Type:'AWS::Lambda::Permission', Properties:{Action:'lambda:InvokeFunction', FunctionName:{Ref:'Channel3Function'}, Principal:'events.amazonaws.com', SourceAccount:{Ref:'AWS::AccountId'}, SourceArn:{'Fn::GetAtt':['BudgetMonitorSchedule','Arn']}}},
      BudgetMonthUnavailableAlarm:alarm('budget_month_unavailable', 3600, 1, 'No valid month allocation is active. Upstream reservations fail closed; review provider allocation and month configuration.'),
      BudgetMonthExpiringAlarm:alarm('budget_month_expiring', 3600, 1, 'The last explicitly approved allocation month expires within seven UTC days. Review renewal; do not infer provider credits.'),
      BudgetMonitorMissingAlarm:{...alarm('budget_monitor_check', 7200, 1, 'No successful allocation-month check in two hours. Inspect schedule and Lambda diagnostics.'), Properties:{...alarm('budget_monitor_check', 7200, 1, 'No successful allocation-month check in two hours. Inspect schedule and Lambda diagnostics.').Properties, ComparisonOperator:'LessThanThreshold', TreatMissingData:'breaching'}},
      PaidUsageAlarm:alarm('search_credit_request', 86400, {Ref:'SearchDailyLimit'}, 'Search HTTP attempts reach the configured daily cap. This credit-bearing endpoint count does not distinguish invoiced/free credits and is not billing reconciliation.'),
      DetailUsageAlarm:alarm('product_detail_request', 86400, {Ref:'DetailDailyLimit'}, 'Product-detail attempts reach the configured request quota. Product retrieval is zero-credit in current public documentation, not the paid lookup endpoint.'),
      BudgetDeniedAlarm:alarm('budget_exceeded', 300, 1, 'The distributed monthly, daily or shared upstream allocation denied a request.'),
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
