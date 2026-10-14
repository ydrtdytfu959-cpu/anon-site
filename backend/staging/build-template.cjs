'use strict';
// Local generator only. Reuses canonical catalog/commerce sources and creates
// separate review resources. It never updates the production API or deploys.
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const ref = name => ({ Ref: name }), get = (name, attribute) => ({ 'Fn::GetAtt': [name, attribute] }), sub = value => ({ 'Fn::Sub': value });
function rebind(value) {
  if (Array.isArray(value)) return value.map(rebind);
  if (!value || typeof value !== 'object') return value;
  if (value.Ref === 'ExistingHttpApiId') return ref('StagingApi');
  if (value.Ref === 'ExistingAuthorizerId') return ref('StagingAuthorizer');
  if (value.Ref === 'CatalogFunctionArn') return get('Channel3Function', 'Arn');
  if (value.Ref === 'CognitoIssuer') return sub('https://cognito-idp.${AWS::Region}.amazonaws.com/${StagingUserPool}');
  if (value.Ref === 'CognitoClientId') return ref('StagingClient');
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, key === 'Fn::Sub' && typeof entry === 'string' ? entry.replaceAll('${ExistingHttpApiId}', '${StagingApi}') : rebind(entry)]));
}
function buildStagingTemplate() {
  const catalog = require('../build-template.cjs').buildTemplate(fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8'));
  const commerce = require('../commerce/build-template.cjs').buildTemplate();
  const parameters = { ...catalog.Parameters, ...commerce.Parameters };
  for (const name of ['ExistingHttpApiId', 'ExistingAuthorizerId', 'CatalogFunctionArn', 'CognitoIssuer', 'CognitoClientId']) delete parameters[name];
  parameters.Channel3SecretArn = { Type: 'String', AllowedPattern: '^arn:aws:secretsmanager:us-east-2:427064007352:secret:AnoX/Channel3/Staging-[A-Za-z0-9]{6}$', Description: 'Separately approved staging-only credential ARN. No default; do not share a production credential or create a secret without approval.' };
  parameters.ExistingAlarmTopicArn = { Type: 'String', AllowedPattern: '^arn:aws:sns:us-east-2:427064007352:AnoX-Staging-[A-Za-z0-9_-]+$', Description: 'Approved dedicated staging notification topic with verified delivery. No default.' };
  parameters.FreeSearchMonthlyCredits.MaxValue = 3;
  parameters.PaidUsageEnabled.AllowedValues = ['false'];
  parameters.PaidSearchMonthlyCredits.MaxValue = 0;
  parameters.SearchDailyLimit.MaxValue = 3;
  parameters.DetailMonthlyLimit.MaxValue = 25;
  parameters.DetailDailyLimit.MaxValue = 25;
  parameters.TotalDailyLimit.Default = 0;
  parameters.TotalDailyLimit.MaxValue = 28;
  parameters.UpstreamPerSecondLimit.Default = 2;
  parameters.UpstreamPerSecondLimit.MaxValue = 2;
  parameters.StagingCatalogConcurrency = { Type: 'Number', Default: 3, MinValue: 1, MaxValue: 3, Description: 'Dedicated staging catalog reservation; commerce default 2 plus catalog 3 require at least 105 initially available concurrency.' };
  const resources = rebind({ ...catalog.Resources, ...commerce.Resources });
  resources.Channel3Function.Properties.FunctionName = sub('${AWS::StackName}-catalog');
  resources.Channel3Function.Properties.ReservedConcurrentExecutions = ref('StagingCatalogConcurrency');
  resources.Channel3Function.Properties.Environment.Variables.METRIC_NAMESPACE = 'AnoX/Staging/Catalog';
  resources.Channel3Function.DependsOn = ['StagingCatalogLogs'];
  resources.StagingCatalogLogs = { Type: 'AWS::Logs::LogGroup', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: { LogGroupName: sub('/aws/lambda/${AWS::StackName}-catalog'), RetentionInDays: 30 } };
  const logStatement = resources.Channel3Role.Properties.Policies[0].PolicyDocument.Statement.find(s => s.Action.includes('logs:PutLogEvents'));
  if (!logStatement) throw Error('Canonical catalog log policy missing');
  logStatement.Resource = sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${AWS::StackName}-catalog:*');
  for (const resource of Object.values(resources)) if (resource.Type === 'AWS::CloudWatch::Alarm' && resource.Properties.Namespace === 'AnoX/Catalog') resource.Properties.Namespace = 'AnoX/Staging/Catalog';
  resources.CommerceFailureMetric.Properties.MetricTransformations[0].MetricNamespace = 'AnoX/Staging/Commerce';
  resources.CommerceFailureAlarm.Properties.Namespace = 'AnoX/Staging/Commerce';
  resources.StagingApi = { Type: 'AWS::ApiGatewayV2::Api', Properties: { Name: sub('${AWS::StackName}-api'), ProtocolType: 'HTTP', CorsConfiguration: { AllowOrigins: ['https://anox.app'], AllowCredentials: false, AllowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'], AllowHeaders: ['content-type', 'authorization', 'Idempotency-Key'], ExposeHeaders: ['Idempotency-Replayed', 'Retry-After'], MaxAge: 300 } } };
  resources.StagingUserPool = { Type: 'AWS::Cognito::UserPool', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: { UserPoolName: sub('${AWS::StackName}-customers'), DeletionProtection: 'ACTIVE', AdminCreateUserConfig: { AllowAdminCreateUserOnly: true }, Policies: { PasswordPolicy: { MinimumLength: 16, RequireLowercase: true, RequireUppercase: true, RequireNumbers: true, RequireSymbols: true, TemporaryPasswordValidityDays: 1 } } } };
  resources.StagingClient = { Type: 'AWS::Cognito::UserPoolClient', Properties: { UserPoolId: ref('StagingUserPool'), ClientName: sub('${AWS::StackName}-review'), GenerateSecret: false, ExplicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'], PreventUserExistenceErrors: 'ENABLED', EnableTokenRevocation: true, AccessTokenValidity: 15, IdTokenValidity: 15, RefreshTokenValidity: 1, TokenValidityUnits: { AccessToken: 'minutes', IdToken: 'minutes', RefreshToken: 'days' } } };
  resources.StagingAuthorizer = { Type: 'AWS::ApiGatewayV2::Authorizer', Properties: { ApiId: ref('StagingApi'), Name: 'StagingCustomerJWT', AuthorizerType: 'JWT', IdentitySource: ['$request.header.Authorization'], JwtConfiguration: { Issuer: sub('https://cognito-idp.${AWS::Region}.amazonaws.com/${StagingUserPool}'), Audience: [ref('StagingClient')] } } };
  resources.SearchRoute = { Type: 'AWS::ApiGatewayV2::Route', Properties: { ApiId: ref('StagingApi'), RouteKey: 'GET /catalog/search', AuthorizationType: 'NONE', Target: { 'Fn::Join': ['/', ['integrations', ref('DetailIntegration')]] } } };
  resources.SearchPermission = { Type: 'AWS::Lambda::Permission', Properties: { Action: 'lambda:InvokeFunction', FunctionName: ref('Channel3Function'), Principal: 'apigateway.amazonaws.com', SourceAccount: ref('AWS::AccountId'), SourceArn: sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${StagingApi}/*/GET/catalog/search') } };
  const routeIds = Object.keys(resources).filter(k => resources[k].Type === 'AWS::ApiGatewayV2::Route');
  // Snapshot deployments do not update just because a route/function changes.
  // A content-derived logical ID creates a new explicitly selected snapshot.
  const deploymentId = 'StagingDeployment' + createHash('sha256').update(JSON.stringify(resources)).digest('hex').slice(0, 16);
  resources[deploymentId] = { Type: 'AWS::ApiGatewayV2::Deployment', DependsOn: routeIds, Properties: { ApiId: ref('StagingApi'), Description: 'Explicit isolated review snapshot; no production API attachment.' } };
  resources.StagingStage = { Type: 'AWS::ApiGatewayV2::Stage', Properties: { ApiId: ref('StagingApi'), StageName: '$default', AutoDeploy: false, DeploymentId: ref(deploymentId), DefaultRouteSettings: { ThrottlingRateLimit: 1, ThrottlingBurstLimit: 2, DetailedMetricsEnabled: true }, RouteSettings: { 'POST /commerce/quotes': { ThrottlingRateLimit: 0.2, ThrottlingBurstLimit: 2 } } } };
  const result = { AWSTemplateFormatVersion: '2010-09-09', Description: 'NOT APPROVED: isolated AnoX Release A review stack. Independent API, Cognito, tables and runtimes; no payments or production bindings.', Parameters: parameters, Conditions: { ...catalog.Conditions, ...commerce.Conditions }, Resources: resources, Outputs: { StagingApiId: { Value: ref('StagingApi') }, StagingBaseUrl: { Value: sub('https://${StagingApi}.execute-api.${AWS::Region}.amazonaws.com') }, StagingPoolId: { Value: ref('StagingUserPool') }, StagingClientId: { Value: ref('StagingClient') }, CatalogFunctionArn: { Value: get('Channel3Function', 'Arn') }, CommerceFunctionArn: { Value: get('CommerceFunction', 'Arn') }, CacheTableName: { Value: ref('CatalogCache') }, CommerceTableName: { Value: ref('CommerceTable') } } };
  const text = JSON.stringify(result);
  for (const forbidden of ['zmumi2wruk', 'us-east-2_gUci3YuMm', '63738r9gpr126qpgp1a5cubchi', 'Production-22Xm3D']) if (text.includes(forbidden)) throw Error('Production identity leaked into isolated staging template');
  if (Buffer.byteLength(text) > 1048576) throw Error('Staging template exceeds S3 template limit');
  return result;
}
function generate() { return JSON.stringify(buildStagingTemplate(), null, 2) + '\n'; }
if (require.main === module) { const file = path.join(__dirname, 'cloudformation.json'), output = generate(); if (process.argv.includes('--check')) { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== output) throw Error('Staging template differs from canonical sources'); } else fs.writeFileSync(file, output); }
module.exports = { buildStagingTemplate, generate };
