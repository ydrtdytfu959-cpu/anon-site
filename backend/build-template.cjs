'use strict';
const fs = require('node:fs');
const path = require('node:path');
function buildTemplate(source) {
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'AnoX Channel3 catalog proxy with scoped runtime credentials and expiring response cache.',
    Parameters: {
      Channel3SecretArn: {
        Type: 'String',
        Description: 'Existing Channel3 secret ARN; only the deployed Lambda resolves its value.',
        Default: 'arn:aws:secretsmanager:us-east-2:427064007352:secret:AnoX/Channel3/Production-22Xm3D',
        AllowedPattern: '^arn:aws:secretsmanager:us-east-2:427064007352:secret:AnoX/Channel3/Production-[A-Za-z0-9]{6}$'
      }
    },
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
            {Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:DeleteItem'], Resource: {'Fn::GetAtt': ['CatalogCache', 'Arn']}},
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
          Environment: {Variables: {CHANNEL3_SECRET_ID: {Ref: 'Channel3SecretArn'}, CACHE_TABLE: {Ref: 'CatalogCache'}}},
          Code: {ZipFile: source}
        }
      }
    },
    Outputs: {
      FunctionName: {Description: 'Existing catalog Lambda function name.', Value: {Ref: 'Channel3Function'}},
      CacheTableName: {Description: 'Expiring Channel3 cache table; independent from CJ products.', Value: {Ref: 'CatalogCache'}}
    }
  };
}
function generatedTemplate() {
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const output = JSON.stringify(buildTemplate(source), null, 2) + '\n';
  if (Buffer.byteLength(output) > 51200) throw Error('Template exceeds inline CloudFormation body size');
  return output;
}
if (require.main === module) {
  const file = path.join(__dirname, 'cloudformation.json'), output = generatedTemplate();
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== output) throw Error('Generated CloudFormation template differs from backend source');
  } else fs.writeFileSync(file, output);
}
module.exports = {buildTemplate};
