'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../backend/index.js');
const month='2026-10', epoch=Date.parse('2026-10-11T12:00:00.000Z');
const policy={budgetMonth:month,freeSearchMonthlyCredits:100,searchDailyLimit:50,detailMonthlyLimit:1000,detailDailyLimit:200,totalDailyLimit:250};
function budget(options={}){return api.createBudget({...policy,now:()=>epoch,store:{reserve:async()=>{}},...options});}
test('unconfigured policy, empty allocation and an expired explicit month spend nothing',async()=>{
  for(const config of [{},{...policy,budgetMonth:''},{...policy,budgetMonth:'2026-09'},{...policy,freeSearchMonthlyCredits:0}]){
    let calls=0;const reserve=api.createBudget({...config,now:()=>epoch,store:{reserve:async()=>{calls++;}}});
    await assert.rejects(reserve('search'));assert.equal(calls,0);
  }
});
test('free allowance is monthly and paid credits require a separate explicit opt-in',async()=>{
  for(const config of [{paidSearchMonthlyCredits:1},{paidSearchMonthlyCredits:1,paidUsageEnabled:'true'},{freeSearchMonthlyCredits:1001},{freeSearchMonthlyCredits:-1},{searchDailyLimit:NaN},{perSecondLimit:0},{budgetMonth:'2026-13'}])assert.throws(()=>budget(config),/INVALID_BUDGET_CONFIG/);
  const calls=[];await budget({freeSearchMonthlyCredits:2,paidSearchMonthlyCredits:3,paidUsageEnabled:true,store:{reserve:async value=>calls.push(value)}})('search');
  assert.equal(calls[0].counters[0].limit,5);assert.match(calls[0].counters[0].key,/2026-10#search$/);
});
test('monthly and daily search/detail counters are distinct and share total daily and rate caps',async()=>{
  const seen=[],reserve=budget({store:{reserve:async value=>seen.push(value)}});await reserve('search');await reserve('detail');
  assert.deepEqual(seen[0].counters.map(x=>x.limit),[100,50,250,5]);assert.deepEqual(seen[1].counters.map(x=>x.limit),[1000,200,250,5]);
  assert.notEqual(seen[0].counters[0].key,seen[1].counters[0].key);assert.notEqual(seen[0].counters[1].key,seen[1].counters[1].key);
  assert.equal(seen[0].counters[2].key,seen[1].counters[2].key);assert.equal(seen[0].counters[3].key,seen[1].counters[3].key);
  assert.ok(seen[0].counters[0].expiresAt>Date.parse('2026-11-01')/1000);
});
test('daily rollover preserves the monthly counter and month rollover requires renewed allocation',async()=>{
  let time=Date.parse('2026-10-30T23:59:59.999Z');const seen=[],reserve=budget({now:()=>time,store:{reserve:async value=>seen.push(value)}});await reserve('search');time++;await reserve('search');
  assert.equal(seen[0].counters[0].key,seen[1].counters[0].key);assert.notEqual(seen[0].counters[1].key,seen[1].counters[1].key);
  time=Date.parse('2026-11-01');await assert.rejects(reserve('search'),e=>e.code==='UPSTREAM_BUDGET_UNAVAILABLE');assert.equal(seen.length,2);await assert.rejects(reserve('unknown'));
});

test('explicit next-month approval preserves October and permits only November without changing caps',async()=>{
  let time=Date.parse('2026-10-31T23:59:59.999Z');const seen=[];
  const reserve=budget({nextBudgetMonth:'2026-11',now:()=>time,freeSearchMonthlyCredits:500,searchDailyLimit:60,detailMonthlyLimit:200,store:{reserve:async value=>seen.push(value)}});
  await reserve('search');time++;await reserve('search');await reserve('detail');
  assert.deepEqual(seen.map(row=>row.counters[0].key),['budget#month#2026-10#search','budget#month#2026-11#search','budget#month#2026-11#detail']);
  assert.deepEqual(seen.map(row=>row.counters[0].limit),[500,500,200]);assert.deepEqual(seen.slice(0,2).map(row=>row.counters[1].limit),[60,60]);
  time=Date.parse('2026-12-01T00:00:00.000Z');await assert.rejects(reserve('search'),e=>e.code==='UPSTREAM_BUDGET_UNAVAILABLE');assert.equal(seen.length,3);
});

test('next month is optional but must be the exact approved successor',()=>{
  for(const patch of [{nextBudgetMonth:'2026-12'},{nextBudgetMonth:'2026-10'},{nextBudgetMonth:'2026-09'},{nextBudgetMonth:'2026-13'},{nextBudgetMonth:'2026-11 '},{nextBudgetMonth:null},{budgetMonth:'',nextBudgetMonth:'2026-11'}])assert.throws(()=>budget(patch),/INVALID_BUDGET_CONFIG/);
});

test('renewal uses UTC year and leap-year boundaries without replacing historical counters',async()=>{
  for(const [current,next,last] of [['2026-12','2027-01','2026-12-31'],['2028-02','2028-03','2028-02-29'],['2027-02','2027-03','2027-02-28']]){
    let time=Date.parse(last+'T23:59:59.999Z');const seen=[],reserve=budget({budgetMonth:current,nextBudgetMonth:next,now:()=>time,store:{reserve:async row=>seen.push(row)}});
    await reserve('search');time++;await reserve('search');
    assert.equal(seen[0].counters[0].key,'budget#month#'+current+'#search');assert.equal(seen[1].counters[0].key,'budget#month#'+next+'#search');
    assert.equal(seen[0].counters[1].key,'budget#'+last+'#search');assert.equal(seen[1].counters[1].key,'budget#'+next+'-01#search');
    assert.equal(seen[0].counters[0].expiresAt,Date.parse(next+'-01T00:00:00.000Z')/1000+90*86400);
  }
});

test('month status warns seven UTC days before the last approved month expires',()=>{
  assert.equal(typeof api.budgetMonthStatus,'function');
  const status=(at,patch={})=>api.budgetMonthStatus({budgetMonth:'2026-10',now:()=>Date.parse(at),...patch});
  assert.equal(status('2026-10-24T23:59:59.999Z').status,'active');
  assert.equal(status('2026-10-25T00:00:00.000Z').status,'expiring');
  assert.equal(status('2026-10-31T23:59:59.999Z').status,'expiring');
  assert.equal(status('2026-11-01T00:00:00.000Z').status,'expired');
  assert.equal(status('2026-10-31T23:59:59.999Z',{nextBudgetMonth:'2026-11'}).status,'active');
  assert.equal(status('2026-11-24T00:00:00.000Z',{nextBudgetMonth:'2026-11'}).status,'expiring');
  assert.equal(status('2026-09-30T23:59:59.999Z').status,'not_started');
  assert.equal(status('2026-10-01T00:00:00.000Z',{budgetMonth:''}).status,'unconfigured');
});

test('expired month emits a dedicated metric while preventing both upstream operation classes',async()=>{
  const metrics=[];let calls=0;const reserve=budget({now:()=>Date.parse('2026-11-01T00:00:00.000Z'),metric:(name,value)=>metrics.push([name,value]),store:{reserve:async()=>calls++}});
  for(const kind of ['search','detail'])await assert.rejects(reserve(kind),e=>e.code==='UPSTREAM_BUDGET_UNAVAILABLE');
  assert.equal(calls,0);assert.ok(metrics.some(([name,value])=>name==='budget_month_unavailable'&&value===1));
});

test('private scheduled month check needs no AWS clients, provider credentials or counter access',async()=>{
  const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../backend/index.js'),'utf8');
  const logs=[],context={module:{exports:{}},console:{log:line=>logs.push(JSON.parse(line))},process:{env:{BUDGET_MONTH:'2026-10',NEXT_BUDGET_MONTH:'2026-11'}},Date:class extends Date{static now(){return Date.parse('2026-11-01T00:00:00.000Z');}},require:name=>{assert.ok(!name.startsWith('@aws-sdk/'),'monitor must not construct AWS clients');return require(name);}};
  vm.runInNewContext(source,context);const result=await context.module.exports.handler({operation:'budget-status'});
  assert.equal(result.status,'active');assert.equal(logs.find(row=>row.event==='budget_month_unavailable')?.budget_month_unavailable,0);
  assert.equal(logs.find(row=>row.event==='budget_monitor_check')?.budget_monitor_check,1);assert.ok(!JSON.stringify(result).includes('secret'));
});

test('public HTTP requests cannot invoke private month diagnostics',async()=>{
  const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../backend/index.js'),'utf8');
  const logs=[];class Client{}const context={module:{exports:{}},console:{log:line=>logs.push(JSON.parse(line))},process:{env:{}},require:name=>name.startsWith('@aws-sdk/')?{DynamoDBClient:Client,SecretsManagerClient:Client}:require(name)};
  vm.runInNewContext(source,context);const result=await context.module.exports.handler({operation:'budget-status',requestContext:{http:{method:'GET'}},rawPath:'/catalog/search'});
  assert.equal(result.status,undefined);assert.ok(!logs.some(row=>row.event==='budget_monitor_check'));
});
test('Dynamo reserves all four counters atomically with one idempotent transaction',async()=>{
  class Command{constructor(input){this.input=input;}}const calls=[],store=api.createDynamoStore({table:'T',commands:{TransactWriteItemsCommand:Command},client:{send:async command=>{calls.push(command.input);return {};}}});
  await budget({store})('search');assert.equal(calls.length,1);assert.equal(calls[0].TransactItems.length,4);assert.ok(calls[0].ClientRequestToken);
  assert.ok(calls[0].TransactItems.every(x=>x.Update.ConditionExpression.includes('#used < :limit')&&x.Update.ConditionExpression.includes('#used >= :zero')));
});
test('Dynamo rejects monthly/daily exhaustion, rate failure and storage conflicts without exposing errors',async()=>{
  class Command{constructor(input){this.input=input;}};
  for(const [index,code,want] of [[0,'ConditionalCheckFailed','UPSTREAM_BUDGET_EXCEEDED'],[1,'ConditionalCheckFailed','UPSTREAM_BUDGET_EXCEEDED'],[2,'ConditionalCheckFailed','UPSTREAM_BUDGET_EXCEEDED'],[3,'ConditionalCheckFailed','UPSTREAM_RATE_LIMITED'],[0,'TransactionConflict','UPSTREAM_BUDGET_UNAVAILABLE']]){
    const reasons=Array.from({length:4},(_,i)=>({Code:i===index?code:'None'}));
    const store=api.createDynamoStore({table:'T',commands:{TransactWriteItemsCommand:Command},client:{send:async()=>{throw Object.assign(Error('PRIVATE'),{name:'TransactionCanceledException',CancellationReasons:reasons});}}});
    await assert.rejects(budget({store})('search'),e=>e.code===want&&!e.message.includes('PRIVATE'));
  }
});
test('concurrent independent workers cannot exceed monthly allocation or partially charge another counter',async()=>{
  class Command{constructor(input){this.input=input;}}const counts=new Map();let calls=0;
  const client={send:async({input})=>{const updates=input.TransactItems.map(x=>x.Update),reasons=updates.map(u=>({Code:(counts.get(u.Key.pk.S)||0)>=Number(u.ExpressionAttributeValues[':limit'].N)?'ConditionalCheckFailed':'None'}));
    if(reasons.some(r=>r.Code!=='None'))throw Object.assign(Error('conflict'),{name:'TransactionCanceledException',CancellationReasons:reasons});
    for(const u of updates)counts.set(u.Key.pk.S,(counts.get(u.Key.pk.S)||0)+1);calls++;return {};}};
  const store=api.createDynamoStore({table:'T',commands:{TransactWriteItemsCommand:Command},client});
  const results=await Promise.allSettled(Array.from({length:20},()=>budget({store,freeSearchMonthlyCredits:2})('search')));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,2);assert.equal(calls,2);assert.deepEqual([...counts.values()],[2,2,2,2]);
});
test('budget rejection/storage failures prevent HTTP without leaking upstream credentials',async()=>{
  for(const store of [{reserve:async()=>{throw Error('PRIVATE data');}},{reserve:async()=>{throw Object.assign(Error('UPSTREAM_BUDGET_EXCEEDED'),{status:429,code:'UPSTREAM_BUDGET_EXCEEDED'});}}]){
    let calls=0;const upstream=api.createUpstream({reserve:budget({store}),getSecret:async()=>'fixture',fetch:async()=>{calls++;return new Response('{}');}});
    await assert.rejects(upstream({query:'shoe',limit:24}),e=>e.code==='UPSTREAM_BUDGET_UNAVAILABLE'&&!e.message.includes('PRIVATE'));assert.equal(calls,0);
  }
});
test('slow budget reservation cannot dispatch using an expired rate window',async()=>{
  let time=epoch+999,calls=0;const reserve=budget({now:()=>time,store:{reserve:async()=>{time+=2;}}});
  const upstream=api.createUpstream({reserve,now:()=>time,getSecret:async()=>'fixture',fetch:async()=>{calls++;return new Response('{}',{headers:{'content-type':'application/json'}});}});
  await assert.rejects(upstream({query:'shoe',limit:24}),e=>e.code==='UPSTREAM_RATE_LIMITED');assert.equal(calls,0);
});
test('failed upstream attempts retain reservations and are never automatically retried',async()=>{
  let calls=0,reservations=0;const upstream=api.createUpstream({now:()=>epoch,reserve:budget({store:{reserve:async()=>{reservations++;}}}),getSecret:async()=>'fixture',fetch:async()=>{calls++;throw Error('offline');}});
  await assert.rejects(upstream({query:'shoe',limit:24}));assert.equal(reservations,1);assert.equal(calls,1);
});

test('changing caps mid-month never changes counter identity or resets allocation',async()=>{
  const seen=[],store={reserve:async input=>seen.push(input)};
  await budget({store})('search');await budget({store,paidUsageEnabled:true,paidSearchMonthlyCredits:20,searchDailyLimit:10})('search');
  assert.deepEqual(seen[0].counters.map(x=>x.key),seen[1].counters.map(x=>x.key));assert.equal(seen[1].counters[0].limit,120);assert.equal(seen[1].counters[1].limit,10);
});
test('paid opt-in alone, a zero daily cap, and absent detail allowance cannot initiate HTTP',async()=>{
  for(const config of [{freeSearchMonthlyCredits:0,paidUsageEnabled:true},{searchDailyLimit:0},{totalDailyLimit:0}]){
    let calls=0;await assert.rejects(budget({...config,store:{reserve:async()=>{calls++;}}})('search'),e=>e.code==='UPSTREAM_BUDGET_EXCEEDED');assert.equal(calls,0);
  }
  await assert.rejects(budget({detailMonthlyLimit:0})('detail'),e=>e.code==='UPSTREAM_BUDGET_EXCEEDED');
});
test('fresh cache survives exhausted allocation and unchanged keys cannot replenish it',async()=>{
  class Command{constructor(input){this.input=input;}}let time=epoch,http=0;const rows=new Map(),counts=new Map();
  const counterStore=api.createDynamoStore({table:'T',commands:{TransactWriteItemsCommand:Command},client:{send:async({input})=>{
    const updates=input.TransactItems.map(x=>x.Update),reasons=updates.map(u=>({Code:(counts.get(u.Key.pk.S)||0)>=Number(u.ExpressionAttributeValues[':limit'].N)?'ConditionalCheckFailed':'None'}));
    if(reasons.some(r=>r.Code!=='None'))throw Object.assign(Error('limit'),{name:'TransactionCanceledException',CancellationReasons:reasons});
    for(const u of updates)counts.set(u.Key.pk.S,(counts.get(u.Key.pk.S)||0)+1);return {};
  }}});
  const cache={get:async key=>structuredClone(rows.get(key)),acquire:async()=>true,publish:async(key,owner,page)=>{rows.set(key,structuredClone(page));},release:async()=>{}};
  const upstream=api.createUpstream({now:()=>time,reserve:budget({now:()=>time,freeSearchMonthlyCredits:1,store:counterStore}),getSecret:async()=>'fixture',fetch:async()=>{http++;return new Response('{"products":[],"next_page_token":null}',{headers:{'content-type':'application/json'}});}});
  const handler=api.createHandler({now:()=>time,store:cache,upstream});const event=q=>({requestContext:{http:{method:'GET'}},rawPath:'/catalog/search',rawQueryString:'q='+q});
  const first=await handler(event('shoe'));assert.equal(first.statusCode,200);const replay=await handler(event('shoe'));assert.equal(replay.body,first.body);assert.equal(http,1);
  assert.equal((await handler(event('coat'))).statusCode,429);assert.equal(http,1);
  await assert.rejects(budget({now:()=>time,freeSearchMonthlyCredits:1,paidUsageEnabled:true,store:counterStore})('search'),e=>e.code==='UPSTREAM_BUDGET_EXCEEDED');
  time+=300000;assert.equal((await handler(event('shoe'))).statusCode,429);assert.equal(http,1);
});
test('runtime rejects malformed environment limits before accessing AWS or HTTP',async()=>{
  const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../backend/index.js'),'utf8');
  for(const patch of [{SEARCH_DAILY_LIMIT:''},{SEARCH_DAILY_LIMIT:' 1'},{SEARCH_DAILY_LIMIT:'1e3'},{SEARCH_DAILY_LIMIT:'01'},{SEARCH_DAILY_LIMIT:'1.5'},{SEARCH_DAILY_LIMIT:'-1'},{PAID_USAGE_ENABLED:'TRUE'},{PAID_SEARCH_MONTHLY_CREDITS:'1',PAID_USAGE_ENABLED:'false'},{FREE_SEARCH_MONTHLY_CREDITS:'1001'},{BUDGET_MONTH:'2026-13'}]){
    let calls=0;const logs=[];class Client{async send(){calls++;throw Error('must not access AWS');}}
    const context={module:{exports:{}},console:{log:line=>logs.push(JSON.parse(line))},process:{env:{CACHE_TABLE:'fixture',CHANNEL3_SECRET_ID:'fixture',...patch}},require:name=>name.startsWith('@aws-sdk/')?{DynamoDBClient:Client,SecretsManagerClient:Client}:require(name)};
    vm.runInNewContext(source,context);const result=await context.module.exports.handler({});assert.equal(result.statusCode,503);assert.equal(JSON.parse(result.body).error,'UPSTREAM_BUDGET_UNAVAILABLE');assert.equal(calls,0);assert.equal(logs.length,1);assert.equal(logs[0].event,'budget_error');assert.equal(logs[0].budget_error,1);assert.ok(!JSON.stringify(logs).includes('fixture'));
  }
});

test('transient Dynamo transaction collisions retry with one idempotency token and never duplicate a reservation',async()=>{
  class Command{constructor(input){this.input=input;}}
  const calls=[];let failures=2;
  const store=api.createDynamoStore({table:'T',commands:{TransactWriteItemsCommand:Command},client:{send:async command=>{
    calls.push(command.input);
    if(failures-->0)throw Object.assign(Error('PRIVATE conflict'),{name:'TransactionCanceledException',
      CancellationReasons:[{Code:'None'},{Code:'TransactionConflict'},{Code:'None'},{Code:'None'}]});
    return {};
  }}});
  await budget({store})('search');
  assert.equal(calls.length,3);
  assert.equal(new Set(calls.map(call=>call.ClientRequestToken)).size,1);
  assert.equal(calls[0].TransactItems.length,4);
  assert.deepEqual(calls[0],calls[1]);
});

test('persistent transaction contention stops after four attempts without revealing storage details',async()=>{
  class Command{constructor(input){this.input=input;}}
  let calls=0;const tokens=[];
  const store=api.createDynamoStore({table:'T',commands:{TransactWriteItemsCommand:Command},client:{send:async command=>{
    calls++;tokens.push(command.input.ClientRequestToken);
    throw Object.assign(Error('PRIVATE transaction details'),{name:'TransactionConflictException'});
  }}});
  await assert.rejects(budget({store})('search'),error=>error.code==='UPSTREAM_BUDGET_UNAVAILABLE'&&!error.message.includes('PRIVATE'));
  assert.equal(calls,4);
  assert.equal(new Set(tokens).size,1);
});
