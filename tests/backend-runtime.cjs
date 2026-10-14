'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../backend/index.js');
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});

test('upstream contract forwards exact continuation and runtime secret without retries',async()=>{
  assert.equal(typeof api.createUpstream,'function');
  const calls=[];let reads=0;
  const upstream=api.createUpstream({getSecret:async()=>{reads++;return '{"apiKey":"synthetic-test-key"}';},fetch:async(url,options)=>{calls.push({url,options});return json({products:[],next_page_token:null});}});
  await upstream({query:'shoe',limit:24,page_token:' +opaque== '});await upstream({query:'coat',limit:12});
  assert.equal(reads,1);assert.equal(calls.length,2);assert.equal(calls[0].url,'https://api.trychannel3.com/v1/search');
  assert.equal(calls[0].options.headers['x-api-key'],'synthetic-test-key');assert.equal(calls[0].options.redirect,'error');
  assert.deepEqual(JSON.parse(calls[0].options.body),{query:'shoe',limit:24,page_token:' +opaque== '});
});
test('runtime secret cache refreshes after five minutes and supports existing formats',async()=>{
  assert.equal(typeof api.createUpstream,'function');let time=0,reads=0;const headers=[];
  const upstream=api.createUpstream({now:()=>time,getSecret:async()=>{reads++;return reads===1?'raw-key':'{"api_key":"rotated"}';},fetch:async(url,options)=>{headers.push(options.headers['x-api-key']);return json({products:[],next_page_token:null});}});
  await upstream({query:'shoe',limit:24});time=300_000;await upstream({query:'shoe',limit:24});assert.deepEqual(headers,['raw-key','rotated']);
});
test('upstream rejects oversized or malformed bodies and cancels reader on size overflow',async()=>{
  assert.equal(typeof api.createUpstream,'function');let cancelled=false;
  const responses=[new Response('not-json',{headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'text/html'}}),new Response('{}',{headers:{'content-type':'application/json','content-length':'2097153'}}),{
    ok:true,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array(2097153)}),cancel:async()=>{cancelled=true;}})}
  }];
  for(const response of responses){const upstream=api.createUpstream({getSecret:async()=>'fake-key',fetch:async()=>response});await assert.rejects(upstream({query:'shoe',limit:24}));}
  assert.equal(cancelled,true);
});
test('upstream cursor rejection is explicit while auth/rate/server failures stay unavailable',async()=>{
  assert.equal(typeof api.createUpstream,'function');
  for(const status of [400,404,410,422,401,429,500]){
    let calls=0;const upstream=api.createUpstream({getSecret:async()=>'fake-key',fetch:async()=>{calls++;return new Response('PRIVATE',{status});}});
    await assert.rejects(upstream({query:'shoe',limit:24,page_token:'next'}),error=>[400,404,410,422].includes(status)?error.status===410&&error.code==='CURSOR_INVALID':error.status===502);
    assert.equal(calls,1);
  }
});
test('upstream cancellation bounds a slow network request',async()=>{
  assert.equal(typeof api.createUpstream,'function');
  const upstream=api.createUpstream({timeoutMs:5,getSecret:async()=>'fake-key',fetch:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))});
  await assert.rejects(upstream({query:'shoe',limit:24}));
});
test('Dynamo adapter uses strong reads, conditional lease and owner-bound atomic publishing',async()=>{
  assert.equal(typeof api.createDynamoStore,'function');
  const calls=[];const client={send:async command=>{calls.push(command);return {};}};
  const commands=Object.fromEntries(['GetItemCommand','PutItemCommand','DeleteItemCommand','TransactWriteItemsCommand'].map(name=>[name,class {constructor(input){this.input=input;this.name=name;}}]));
  const store=api.createDynamoStore({client,commands,table:'Cache'});
  await store.get('page#one');assert.equal(calls[0].input.ConsistentRead,true);
  assert.equal(await store.acquire('page#one','owner',1000,26000),true);assert.equal(calls[1].input.ExpressionAttributeValues[':now'].N,'1000');
  await store.publish('page#one','owner',{kind:'page',expiresAtMs:5000,payload:{}},{key:'cursor#two',value:{kind:'cursor',expiresAtMs:9000,count:24}},2000);
  const transaction=calls[2].input;assert.equal(transaction.TransactItems.length,3);assert.equal(transaction.ClientRequestToken,'owner');
  assert.equal(transaction.TransactItems[0].Put.Item.expiresAt.N,'5');assert.equal(transaction.TransactItems[1].Put.Item.expiresAt.N,'9');
  assert.equal(transaction.TransactItems[2].Delete.ExpressionAttributeValues[':owner'].S,'owner');assert.equal(transaction.TransactItems[2].Delete.ExpressionAttributeValues[':now'].N,'2000');
  await store.release('page#one','owner');assert.equal(calls[3].input.ExpressionAttributeValues[':owner'].S,'owner');
});
test('Dynamo lease contention differs from an infrastructure failure',async()=>{
  assert.equal(typeof api.createDynamoStore,'function');
  const commands=Object.fromEntries(['GetItemCommand','PutItemCommand','DeleteItemCommand','TransactWriteItemsCommand'].map(name=>[name,class {constructor(input){this.input=input;}}]));
  const conditional=api.createDynamoStore({commands,table:'Cache',client:{send:async()=>{throw Object.assign(Error(),{name:'ConditionalCheckFailedException'});}}});
  assert.equal(await conditional.acquire('page','owner',1,2),false);await conditional.release('page','owner');
  const broken=api.createDynamoStore({commands,table:'Cache',client:{send:async()=>{throw Error('denied');}}});await assert.rejects(broken.acquire('page','owner',1,2));
});
test('EMF emits bounded count labels without accepting request data',()=>{
  assert.equal(typeof api.createMetric,'function');const logs=[];
  const metric=api.createMetric({log:line=>logs.push(JSON.parse(line)),now:()=>123});metric('cache_hit');metric('raw-secret-query');
  assert.equal(logs.length,1);assert.equal(logs[0].cache_hit,1);assert.equal(logs[0]._aws.Timestamp,123);assert.deepEqual(logs[0]._aws.CloudWatchMetrics[0].Dimensions,[['Service']]);
});
test('actual upstream request metric counts HTTP attempts but not secret failures',async()=>{
  const metrics=[];let calls=0;
  const bad=api.createUpstream({metric:name=>metrics.push(name),getSecret:async()=>{throw Error('secret unavailable');},fetch:async()=>{calls++;return json({products:[],next_page_token:null});}});
  await assert.rejects(bad({query:'shoe',limit:24}));assert.equal(metrics.length,0);assert.equal(calls,0);
  const good=api.createUpstream({metric:name=>metrics.push(name),getSecret:async()=>'fake',fetch:async()=>{calls++;return json({products:[],next_page_token:null});}});
  await good({query:'shoe',limit:24});assert.deepEqual(metrics,['upstream_request']);assert.equal(calls,1);
});
test('cursor expiring during runtime secret access cannot initiate HTTP or count a request',async()=>{
  let time=10,calls=0;const metrics=[];
  const upstream=api.createUpstream({now:()=>time,metric:name=>metrics.push(name),getSecret:async()=>{time=12;return 'fake';},fetch:async()=>{calls++;return json({products:[],next_page_token:null});}});
  await assert.rejects(upstream({query:'shoe',limit:24,page_token:'next'},{expiresAt:11}),error=>error.status===410&&error.code==='CURSOR_EXPIRED');
  assert.equal(calls,0);assert.deepEqual(metrics,[]);
});
