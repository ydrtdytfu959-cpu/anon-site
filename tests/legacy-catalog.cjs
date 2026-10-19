'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../backend/legacy-catalog');

const row = i => ({id:'nike-'+i, advertiserId:'4942550', advertiserName:'NIKE', brand:'Nike', title:'Nike product '+i,
  imageLink:'https://static.nike.com/image.png', link:'https://www.nike.com/t/product-'+i,
  availability:'in stock', price:{amount:'45',currency:'USD'}, lastUpdated:'2026-10-16T10:00:00Z'});
// Emulate only AWS/network boundaries; execute the actual module and cache logic.
function load({baseline=false, rows=[row(1)], upstreamStatus=200, unprocessed=false, stored=null,
  secretString=JSON.stringify({token:'test-only-fixture',websiteId:'test-publisher'}), secretError=null,
  totalCount=rows.length, advertiserId='4942550'}={}) {
  const requests=[], secrets=[], writes=[], logs=[], modules=new Map();
  const Command=class {constructor(input){this.input=input;}};
  class GetItemCommand extends Command {}
  class BatchWriteItemCommand extends Command {}
  class GetSecretValueCommand extends Command {}
  const sdk={DynamoDBClient:class {async send(command){
    if(command instanceof GetItemCommand)return stored?{Item:stored}:{};
    if(command instanceof BatchWriteItemCommand){writes.push(command.input);return {UnprocessedItems:unprocessed?command.input.RequestItems:{}};}
    throw Error('Unexpected DynamoDB operation');
  }},GetItemCommand,BatchWriteItemCommand,SecretsManagerClient:class {async send(command){
    secrets.push(command.input.SecretId);if(secretError)throw secretError;return {SecretString:secretString};
  }},GetSecretValueCommand};
  function moduleAt(filename) {
    if(modules.has(filename))return modules.get(filename).exports;
    const mod={exports:{}};modules.set(filename,mod);
    const context={module:mod,exports:mod.exports,Date,Number,JSON,Math,Buffer,AbortSignal,URL,
      console:{error(...args){logs.push(args);},log(...args){logs.push(args);}},process:{env:{PRODUCTS_TABLE:'products',CJ_SECRET_ID:'cj-fixture',CJ_COMPANY_ID:'company',NIKE_ADVERTISER_ID:advertiserId}},
      require(name){if(name.startsWith('@aws-sdk/'))return sdk;if(name.startsWith('./'))return moduleAt(path.resolve(path.dirname(filename),name+'.js'));throw Error('Unexpected import '+name);},
      fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {ok:upstreamStatus===200,status:upstreamStatus,text:async()=>JSON.stringify({data:{shoppingProducts:{totalCount,count:rows.length,resultList:rows}}})};}};
    vm.runInNewContext(fs.readFileSync(filename,'utf8'),context,{filename});return mod.exports;
  }
  const candidate=path.join(root,'index.js');
  const filename=baseline||!fs.existsSync(candidate)?path.join(root,'deployed-index.js'):candidate;
  return {handler:moduleAt(filename).handler,requests,secrets,writes,logs};
}
const http=(path='/catalog/products',query={})=>({requestContext:{http:{method:'GET'}},rawPath:path,queryStringParameters:query});

test('deployed package reproduces the scheduled warmer 404 without a provider call',async()=>{
  const x=load({baseline:true});const response=await x.handler({action:'warm'});
  assert.equal(response.statusCode,404);assert.equal(x.requests.length,0);assert.equal(x.writes.length,0);
});
test('warm action fetches one bounded Nike-only CJ page and persists the cache',async()=>{
  const x=load({rows:Array.from({length:30},(_,i)=>row(i))});const result=await x.handler({action:'warm'});
  assert.equal(result.ok,true);assert.equal(result.source,'CJ');assert.equal(result.warmed,20);
  assert.equal(x.requests.length,1);assert.equal(x.requests[0].url,'https://ads.api.cj.com/query');
  assert.deepEqual(x.requests[0].body.variables.partners,['4942550']);assert.equal(x.requests[0].body.variables.limit,20);
  assert.equal(x.requests[0].body.variables.offset,0);assert.equal(x.requests[0].body.variables.keywords,null);
  assert.deepEqual(x.secrets,['cj-fixture']);
  const saved=x.writes.flatMap(w=>w.RequestItems.products);assert.equal(saved.length,20);
  assert.equal(JSON.parse(saved[0].PutRequest.Item.payload.S).advertiserName,'NIKE');
});
test('warm input cannot override budget, retailer, offset, source or HTTP routing',async()=>{
  for(const extra of [{limit:1000},{offset:5000},{q:'adidas'},{website_ids:['x']},{rawPath:'/catalog/products'},
    {requestContext:{http:{method:'GET'}}},{source:'channel3'}]) {
    const x=load();await assert.rejects(x.handler({action:'warm',...extra}),/INVALID_WARM_EVENT/);
    assert.equal(x.requests.length,0);assert.equal(x.secrets.length,0);assert.equal(x.writes.length,0);
  }
});
test('scheduled provider failure rejects invocation instead of succeeding with an HTTP 502 body',async()=>{
  const x=load({upstreamStatus:503});await assert.rejects(x.handler({action:'warm'}),/CATALOG_WARM_FAILED/);
  assert.equal(x.requests.length,1);assert.equal(x.writes.length,0);
});
test('exhausted cache writes fail the scheduled invocation after bounded retries',async()=>{
  const x=load({unprocessed:true});await assert.rejects(x.handler({action:'warm'}),/CATALOG_WARM_FAILED/);
  assert.equal(x.requests.length,1);assert.equal(x.writes.length,3);
});
test('empty source response cannot be reported as a successful cache warm',async()=>{
  const x=load({rows:[]});await assert.rejects(x.handler({action:'warm'}),/CATALOG_WARM_EMPTY/);
  assert.equal(x.requests.length,1);assert.equal(x.writes.length,0);
});
test('ordinary CJ list response and detail cache contract remain compatible',async()=>{
  const x=load();const response=await x.handler(http('/catalog/products',{q:'Nike',limit:'1',offset:'3'}));
  assert.equal(response.statusCode,200);const b=JSON.parse(response.body);
  assert.equal(b.source,'CJ');assert.equal(b.advertiser,'NIKE');assert.equal(b.count,1);assert.equal(b.offset,3);
  assert.equal(x.requests[0].body.variables.limit,1);assert.deepEqual(x.requests[0].body.variables.keywords,['Nike']);
  const saved=x.writes[0].RequestItems.products[0].PutRequest.Item;
  const cached=load({stored:saved});const detail=await cached.handler(http('/catalog/products/nike-1'));
  assert.equal(detail.statusCode,200);assert.equal(JSON.parse(detail.body).source,'cache');
  assert.equal(cached.requests.length,0);assert.equal(cached.secrets.length,0);
});
test('ordinary HTTP provider failures retain their safe 502 response',async()=>{
  const x=load({upstreamStatus:503});const r=await x.handler(http());
  assert.equal(r.statusCode,502);assert.equal(JSON.parse(r.body).error,'catalog upstream unavailable');
});

test('warm refuses unapproved merchant rows before cache writes or a Nike success claim',async()=>{
  for(const patch of [{advertiserId:'unapproved',advertiserName:'Reseller',link:'https://reseller.example/item'},
    {advertiserId:'1'},{advertiserName:'Reseller'},{link:'https://nike.com.evil.example/item'},
    {link:'https://user@www.nike.com/item'},{link:'https://www.nike.com:444/item'},{link:'http://www.nike.com/item'},
    {link:'https://nike.com./item'},{link:null}]) {
    const x=load({rows:[{...row(1),...patch}]});
    await assert.rejects(x.handler({action:'warm'}),/CATALOG_WARM_EMPTY/);
    assert.equal(x.writes.length,0);assert.equal(x.requests.length,1);
  }
});
test('merchant validation preserves legitimate Nike and Jordan rows in mixed CJ pages',async()=>{
  const valid=[row(1),{...row(2),advertiserName:'Nike',brand:'Jordan',link:'https://nike.com/t/jordan?nikegos=true'}];
  const x=load({rows:[...valid,{...row(3),advertiserId:'unapproved',advertiserName:'Reseller',link:'https://reseller.example/item'}]});
  const response=await x.handler(http());const data=JSON.parse(response.body);
  assert.equal(response.statusCode,200);assert.equal(data.count,2);
  assert.deepEqual(data.products.map(p=>p.productId),['nike-1','nike-2']);
  assert.equal(data.products[1].brand,'Jordan');
  assert.equal(x.writes[0].RequestItems.products.length,2);
});
test('detail rejects an unapproved provider product without populating cache',async()=>{
  const x=load({rows:[{...row(1),advertiserId:'unapproved',advertiserName:'Reseller',link:'https://reseller.example/item'}]});
  const response=await x.handler(http('/catalog/products/nike-1'));
  assert.equal(response.statusCode,502);assert.equal(x.writes.length,0);
});
test('fresh unapproved cache records cannot bypass official merchant validation',async()=>{
  const x=load({stored:{syncedAt:{N:String(Date.now())},payload:{S:JSON.stringify({productId:'nike-1',
    advertiserId:'unapproved',advertiserName:'Reseller',productUrl:'https://reseller.example/item'})}}});
  const response=await x.handler(http('/catalog/products/nike-1'));const data=JSON.parse(response.body);
  assert.equal(response.statusCode,200);assert.equal(data.source,'CJ');assert.equal(data.product.advertiserId,'4942550');
  assert.equal(x.requests.length,1);
});
test('malformed credential JSON is never included in HTTP errors or captured logs',async()=>{
  // Keep the fixture short: V8 includes only a prefix of malformed JSON in its
  // parse error. A long sentinel would incorrectly miss that partial leak.
  const marker='LEAKME';
  for(const event of [http(),{action:'warm'}]) {
    const x=load({secretString:marker});
    if(event.action)await assert.rejects(x.handler(event),/CATALOG_WARM_FAILED/);
    else {const response=await x.handler(event);assert.equal(response.statusCode,502);assert.ok(!response.body.includes(marker));}
    assert.equal(x.requests.length,0);assert.equal(x.writes.length,0);
    assert.ok(x.logs.length>0);assert.ok(!JSON.stringify(x.logs).includes(marker));
  }
});
test('SDK exception text cannot expose credential fragments in catalog logs',async()=>{
  const marker='PRIVATE_SDK_DIAGNOSTIC_FIXTURE';const x=load({secretError:Error(marker)});
  const response=await x.handler(http());assert.equal(response.statusCode,502);
  assert.equal(x.requests.length,0);assert.ok(!JSON.stringify(x.logs).includes(marker));
});

test('misconfigured advertiser fails before credentials or provider calls',async()=>{
  const x=load({advertiserId:'unapproved'});await assert.rejects(x.handler({action:'warm'}),/CATALOG_WARM_FAILED/);
  assert.equal(x.requests.length,0);assert.equal(x.secrets.length,0);assert.equal(x.writes.length,0);
});
test('detail response must preserve the requested source product identity',async()=>{
  const x=load({rows:[row(2)]});const response=await x.handler(http('/catalog/products/nike-1'));
  assert.equal(response.statusCode,502);assert.equal(x.writes.length,0);
});
test('filtered pages preserve raw pagination and absolute source positions',async()=>{
  const invalid={...row(9),advertiserId:'unapproved'};
  const x=load({rows:[invalid,row(1),invalid,row(2)],totalCount:20});
  const response=await x.handler(http('/catalog/products',{offset:'4',limit:'4'}));const data=JSON.parse(response.body);
  assert.equal(response.statusCode,200);assert.equal(data.count,2);assert.equal(data.rawCount,4);assert.equal(data.nextOffset,8);
  assert.deepEqual(data.products.map(p=>p.sourceIndex),[5,7]);
  assert.ok(x.writes[0].RequestItems.products.every(r=>!Object.hasOwn(JSON.parse(r.PutRequest.Item.payload.S),'sourceIndex')),
    'Pagination positions are response metadata and must not become product identity/cache fields');
});
test('fully rejected page can continue to later provider rows',async()=>{
  const x=load({rows:[{...row(1),advertiserId:'unapproved'},{...row(2),link:'https://reseller.example/item'}],totalCount:4});
  const response=await x.handler(http('/catalog/products',{limit:'2'}));const data=JSON.parse(response.body);
  assert.equal(response.statusCode,200);assert.equal(data.count,0);assert.equal(data.rawCount,2);assert.equal(data.nextOffset,2);
  assert.equal(x.writes.length,0);
});
test('raw pagination stays bounded and terminates on empty or exhausted source',async()=>{
  for(const sample of [{rows:[],totalCount:100,offset:'0',limit:'2',rawCount:0},
    {rows:[row(1)],totalCount:1,offset:'0',limit:'2',rawCount:1},
    {rows:[row(1),row(2)],totalCount:9000,offset:'5000',limit:'2',rawCount:2}]) {
    const x=load(sample);const data=JSON.parse((await x.handler(http('/catalog/products',{offset:sample.offset,limit:sample.limit}))).body);
    assert.equal(data.rawCount,sample.rawCount);assert.equal(data.nextOffset,null);
  }
  const x=load({rows:[row(1),row(2),row(3)],totalCount:10});
  const data=JSON.parse((await x.handler(http('/catalog/products',{limit:'2'}))).body);
  assert.equal(data.rawCount,2);assert.equal(data.nextOffset,2);assert.deepEqual(data.products.map(p=>p.sourceIndex),[0,1]);
});

test('replacement and rollback packages reproduce with verified original source',()=>{
  const os=require('node:os'),crypto=require('node:crypto');
  const {execFileSync}=require('node:child_process');
  const {build}=require('../backend/legacy-catalog/build.cjs');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'anox-legacy-package-test-'));
  try {
    const first=build(path.join(temporary,'a')),second=build(path.join(temporary,'b'));
    assert.deepEqual(first,second);
    for(const name of ['candidate','rollback']) {
      const a=fs.readFileSync(path.join(temporary,'a',name+'.zip'));
      assert.deepEqual(a,fs.readFileSync(path.join(temporary,'b',name+'.zip')));
      assert.equal(crypto.createHash('sha256').update(a).digest('hex'),first.packages[name].sha256);
    }
    const rollback=execFileSync('unzip',['-p',path.join(temporary,'a','rollback.zip'),'index.js']);
    assert.deepEqual(rollback,fs.readFileSync(path.join(root,'deployed-index.js')));
    const candidate=execFileSync('unzip',['-p',path.join(temporary,'a','candidate.zip'),'index.js']);
    assert.deepEqual(candidate,fs.readFileSync(path.join(root,'index.js')));
    const names=execFileSync('unzip',['-Z1',path.join(temporary,'a','candidate.zip')],{encoding:'utf8'}).trim().split('\n');
    assert.deepEqual(names,['cj-handler.js','index.js']);
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
});
