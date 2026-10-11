'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../backend/index.js');
test('daily paid and free-detail counters stay separate while sharing a bounded rate',async()=>{
  const seen=[],reserve=api.createBudget({store:{reserve:async input=>seen.push(input)},now:()=>1800000000123,paidDailyLimit:500,detailDailyLimit:2000,perSecondLimit:5});
  await reserve('paid');await reserve('detail');
  assert.equal(seen[0].dailyLimit,500);assert.equal(seen[1].dailyLimit,2000);assert.notEqual(seen[0].dailyKey,seen[1].dailyKey);assert.equal(seen[0].rateKey,seen[1].rateKey);assert.equal(seen[0].rateLimit,5);
});
test('budget rejection prevents HTTP and is safely exposed instead of spending upstream credits',async()=>{
  let calls=0;const upstream=api.createUpstream({getSecret:async()=>'fixture',reserve:async()=>{throw Object.assign(Error('UPSTREAM_BUDGET_EXCEEDED'),{status:429,code:'UPSTREAM_BUDGET_EXCEEDED'});},fetch:async()=>{calls++;return new Response('{}');}});
  await assert.rejects(upstream({query:'shoe',limit:24}),e=>e.code==='UPSTREAM_BUDGET_EXCEEDED');assert.equal(calls,0);
});
test('Dynamo reserves daily and rate counters atomically with an idempotent transaction',async()=>{
  class Command{constructor(input){this.input=input;}}const calls=[],store=api.createDynamoStore({table:'T',commands:{TransactWriteItemsCommand:Command},client:{send:async command=>{calls.push(command.input);return {};}}});
  await store.reserve({dailyKey:'day',rateKey:'second',dailyLimit:2,rateLimit:1,expiresAt:1800000000});
  assert.equal(calls.length,1);assert.equal(calls[0].TransactItems.length,2);assert.ok(calls[0].ClientRequestToken);assert.ok(calls[0].TransactItems.every(x=>x.Update.ConditionExpression.includes('#used < :limit')));
});
test('invalid budget configuration and storage outages fail closed before HTTP',async()=>{
  for(const patch of [{paidDailyLimit:NaN},{detailDailyLimit:-1},{perSecondLimit:0}])assert.throws(()=>api.createBudget({store:{reserve:async()=>{}},...patch}));
  let calls=0;const reserve=api.createBudget({store:{reserve:async()=>{throw Error('PRIVATE data');}}});const upstream=api.createUpstream({reserve,getSecret:async()=>'fixture',fetch:async()=>{calls++;return new Response('{}');}});
  await assert.rejects(upstream({query:'x',limit:24}),error=>error.code==='UPSTREAM_BUDGET_UNAVAILABLE'&&!error.message.includes('PRIVATE'));assert.equal(calls,0);
});
test('Dynamo budget conditional rejections are separated from rate and infrastructure failures',async()=>{
  class Command{constructor(input){this.input=input;}};
  for(const [reasons,want] of [[[{Code:'ConditionalCheckFailed'},{Code:'None'}],'UPSTREAM_BUDGET_EXCEEDED'],[[{Code:'None'},{Code:'ConditionalCheckFailed'}],'UPSTREAM_RATE_LIMITED'],[[{Code:'TransactionConflict'},{Code:'None'}],'UPSTREAM_BUDGET_UNAVAILABLE']]){
    const store=api.createDynamoStore({table:'T',commands:{TransactWriteItemsCommand:Command},client:{send:async()=>{throw Object.assign(Error('PRIVATE'),{name:'TransactionCanceledException',CancellationReasons:reasons});}}});
    await assert.rejects(store.reserve({dailyKey:'day',rateKey:'sec',dailyLimit:2,rateLimit:1,expiresAt:1800000000}),error=>error.code===want&&!error.message.includes('PRIVATE'));
  }
});
test('daily reservations switch at UTC midnight while cache hits need no upstream budget',async()=>{
  let time=Date.parse('2026-10-09T23:59:59.999Z');const seen=[],reserve=api.createBudget({store:{reserve:async value=>seen.push(value)},now:()=>time});await reserve('paid');time++;await reserve('paid');
  assert.notEqual(seen[0].dailyKey,seen[1].dailyKey);assert.notEqual(seen[0].rateKey,seen[1].rateKey);assert.ok(seen[0].expiresAt>time/1000);await assert.rejects(reserve('unknown'));
});
test('slow budget reservation cannot use an expired rate slot to release a later burst',async()=>{
  let time=1800000000999,calls=0;const reserve=api.createBudget({now:()=>time,store:{reserve:async()=>{time+=2;}}});
  const upstream=api.createUpstream({reserve,now:()=>time,getSecret:async()=>'fixture',fetch:async()=>{calls++;return new Response('{}',{headers:{'content-type':'application/json'}});}});
  await assert.rejects(upstream({query:'shoe',limit:24}),error=>error.code==='UPSTREAM_RATE_LIMITED');assert.equal(calls,0);
});
