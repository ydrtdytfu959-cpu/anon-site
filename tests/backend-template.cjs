'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {buildTemplate}=require('../backend/build-template.cjs');
const source=fs.readFileSync(require.resolve('../backend/index.js'),'utf8');
test('template preserves function identity and isolates secret/cache/log permissions',()=>{
  const template=buildTemplate(source),resources=template.Resources;
  assert.ok(resources?.Channel3Function,'existing logical function must be preserved');
  const fn=resources.Channel3Function.Properties;assert.equal(fn.FunctionName,'AnoX-Channel3-Catalog');assert.equal(fn.Runtime,'nodejs24.x');assert.equal(fn.Handler,'index.handler');assert.equal(fn.Timeout,20);assert.equal(fn.MemorySize,256);
  assert.deepEqual(fn.Role,{'Fn::GetAtt':['Channel3Role','Arn']});assert.deepEqual(fn.Environment.Variables.CACHE_TABLE,{Ref:'CatalogCache'});
  const table=resources.CatalogCache;assert.equal(table.Properties.BillingMode,'PAY_PER_REQUEST');assert.deepEqual(table.Properties.KeySchema,[{AttributeName:'pk',KeyType:'HASH'}]);assert.deepEqual(table.Properties.TimeToLiveSpecification,{AttributeName:'expiresAt',Enabled:true});assert.equal(table.DeletionPolicy,'Retain');
  const statements=resources.Channel3Role.Properties.Policies[0].PolicyDocument.Statement;
  const secret=statements.find(row=>row.Action.includes('secretsmanager:GetSecretValue'));assert.deepEqual(secret.Resource,{Ref:'Channel3SecretArn'});
  const db=statements.find(row=>row.Action.includes('dynamodb:GetItem'));assert.deepEqual(db.Resource,{'Fn::GetAtt':['CatalogCache','Arn']});assert.ok(!db.Action.includes('dynamodb:Scan'));
  assert.ok(statements.every(row=>row.Resource!=='*'));assert.ok(!JSON.stringify(resources).includes('AnoX-Products'));
});
test('template bundles runnable handler byte-for-byte and remains within inline CF limit',()=>{
  const template=buildTemplate(source);assert.equal(template.Resources?.Channel3Function?.Properties?.Code?.ZipFile,source);
  const context={module:{exports:{}},require};vm.runInNewContext(template.Resources.Channel3Function.Properties.Code.ZipFile,context);
  assert.equal(typeof context.module.exports.handler,'function');assert.equal(typeof context.module.exports.createHandler,'function');
  assert.ok(Buffer.byteLength(JSON.stringify(template,null,2))<51200);
});
