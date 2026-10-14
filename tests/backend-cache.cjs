'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHandler} = require('../backend/index.js');

// DynamoDB and upstream HTTP are external. This store preserves conditional-write
// semantics while the actual handler, key construction and sanitization run here.
function memoryStore() {
  const rows = new Map(), leases = new Map();
  return {rows, leases,
    async get(key) { return structuredClone(rows.get(key)); },
    async acquire(key, owner, now, until) {
      if (leases.get(key)?.until > now) return false;
      leases.set(key, {owner, until}); return true;
    },
    async publish(key, owner, page, cursor, now) {
      const lease = leases.get(key);
      if (!lease || lease.owner !== owner || lease.until <= now) throw Error('lost lease');
      rows.set(key, structuredClone(page));
      if (cursor) rows.set(cursor.key, structuredClone(cursor.value));
      leases.delete(key);
    },
    async release(key, owner) {if (leases.get(key)?.owner === owner) leases.delete(key);}
  };
}
const product = id => ({id,title:'Shoe '+id,description:'Catalog description',
  brands:[{id:'brand1',name:'Brand'}],images:[{url:'https://cdn.trychannel3.com/'+id+'.jpg',alt_text:'Shoe'}, {url:'https://cdn.trychannel3.com/second.jpg'}],
  category:{slug:'shoes',title:'Shoes',path:[{slug:'fashion',title:'Fashion'}]},
  offers:[{url:'https://buy.trychannel3.com/'+id,domain:'example.com',price:{price:49.95,currency:'USD',compare_at_price:59.95},availability:'InStock',condition:'new'}],
  variants:{options:[{name:'Size',values:[{label:'9',exists:true,available:'InStock',product_id:id}]}],selected:[{name:'Color',label:'Black'}]},
  private_key:'UPSTREAM_PRIVATE',trace:{headers:{authorization:'UPSTREAM_PRIVATE'}}});
const event = params => ({requestContext:{http:{method:'GET'}},rawPath:'/catalog/search',rawQueryString:new URLSearchParams(params).toString(),queryStringParameters:params});
const body = response => JSON.parse(response.body);
function fixture(upstream, shared=memoryStore()) {
  let time=1_800_000_000_000;
  const calls=[],logs=[];
  const handler=createHandler({store:shared,now:()=>time,sleep:ms=>new Promise(r=>setTimeout(r,Math.min(ms,5))),metric:name=>logs.push(name),
    upstream:async input=>{calls.push(structuredClone(input));return upstream?upstream(input,calls.length):{products:[product('p1')],next_page_token:null};}});
  return {handler,calls,logs,store:shared,advance:ms=>{time+=ms;}};
}

test('identical query reuses fresh sanitized cache without another upstream credit', async()=>{
  const f=fixture(),request=event({q:'black shoes',limit:'24'});
  const first=await f.handler(request),second=await f.handler(request);
  assert.equal(first.statusCode,200);assert.deepEqual(body(second),body(first));assert.equal(f.calls.length,1);
  assert.equal(body(first).provider,'channel3');assert.equal(body(first).data.products[0].images.length,1);
  assert.ok(!JSON.stringify(body(first)).includes('UPSTREAM_PRIVATE'));
  assert.equal(Date.parse(body(first).expiresAt)-Date.parse(body(first).fetchedAt),300_000);
  assert.deepEqual(f.logs,['cache_miss','cache_hit']);
});
test('search expiration fetches a current price and never silently serves stale data',async()=>{
  const f=fixture((input,n)=>({products:[{...product('p1'),title:'Version '+n}],next_page_token:null}));
  await f.handler(event({q:'shoe'}));f.advance(300_000);
  const response=await f.handler(event({q:'shoe'}));assert.equal(body(response).data.products[0].title,'Version 2');assert.equal(f.calls.length,2);
});
test('discovery has a ten-minute lifetime and fixed backend query isolated from text search',async()=>{
  const f=fixture();const first=body(await f.handler(event({section:'men'})));
  assert.equal(Date.parse(first.expiresAt)-Date.parse(first.fetchedAt),600_000);
  assert.equal(f.calls[0].query,"men's fashion");
  await f.handler(event({q:"men's fashion"}));assert.equal(f.calls.length,2);
});
test('query case, section, limit and filters stay separate while equivalent filters coalesce',async()=>{
  const f=fixture();
  for(const params of [{q:'Shoe'},{q:'shoe'},{q:'shoe',limit:'12'},{q:'shoe',filters:'{"conditions":["new"]}'},{section:'shoes'},{section:'clothing'}])await f.handler(event(params));
  assert.equal(f.calls.length,6);
  await f.handler(event({q:'shoe',filters:'{"availability":["OutOfStock","InStock"],"conditions":["used","new"]}'}));
  await f.handler(event({q:'shoe',filters:'{"conditions":["new","used"],"availability":["InStock","OutOfStock"]}'}));
  assert.equal(f.calls.length,7);
});
test('cursor is preserved exactly, bound to context, and exhausted pages return null',async()=>{
  const token=' +opaque/token== ';
  const f=fixture(input=>({products:[product(input.page_token?'p2':'p1')],next_page_token:input.page_token?null:token}));
  const first=body(await f.handler(event({q:'shoe',limit:'12'})));assert.equal(first.data.next_page_token,token);
  for(const changed of [{q:'coat',limit:'12'},{q:'shoe',limit:'24'},{q:'shoe',limit:'12',filters:'{"conditions":["new"]}'}]) {
    const denied=await f.handler(event({...changed,page_token:token}));assert.equal(denied.statusCode,400);assert.equal(body(denied).error,'CURSOR_INVALID');
  }
  const next=await f.handler(event({q:'shoe',limit:'12',page_token:token}));assert.equal(next.statusCode,200);assert.equal(body(next).data.next_page_token,null);
  assert.deepEqual(f.calls[1],{query:'shoe',limit:12,page_token:token});assert.equal(f.calls.length,2);
});
test('expired cursor explicitly requires restart without another upstream request',async()=>{
  const f=fixture(()=>({products:[product('p1')],next_page_token:'next'}));await f.handler(event({q:'shoe'}));f.advance(1_800_000);
  const response=await f.handler(event({q:'shoe',page_token:'next'}));assert.equal(response.statusCode,410);assert.equal(body(response).error,'CURSOR_EXPIRED');assert.equal(f.calls.length,1);
});
test('cold concurrent requests in one process use one upstream operation',async()=>{
  const f=fixture(async()=>{await new Promise(r=>setTimeout(r,15));return {products:[product('p1')],next_page_token:null};});
  const results=await Promise.all(Array.from({length:12},()=>f.handler(event({q:'shoe'}))));
  assert.ok(results.every(r=>r.statusCode===200));assert.equal(f.calls.length,1);
});
test('different Lambda instances share the lease and wait for one durable page',async()=>{
  const store=memoryStore();let count=0;
  const upstream=async()=>{count++;await new Promise(r=>setTimeout(r,20));return {products:[product('p1')],next_page_token:null};};
  const a=fixture(upstream,store),b=fixture(upstream,store);
  const results=await Promise.all([a.handler(event({q:'shoe'})),b.handler(event({q:'shoe'}))]);
  assert.ok(results.every(r=>r.statusCode===200));assert.equal(count,1);
});
test('upstream failure does not poison successful page cache; deliberate retry can recover',async()=>{
  const f=fixture((input,n)=>{if(n===1)throw Object.assign(Error('PRIVATE body'),{status:503});return {products:[product('p1')],next_page_token:null};});
  const bad=await f.handler(event({q:'shoe'}));assert.equal(bad.statusCode,502);assert.equal(f.store.rows.size,0);assert.equal(f.store.leases.size,0);assert.ok(!bad.body.includes('PRIVATE'));
  const good=await f.handler(event({q:'shoe'}));assert.equal(good.statusCode,200);assert.equal(f.calls.length,2);
});
test('failed cache read, acquire or durable publish never bypasses required cache',async()=>{
  for(const operation of ['get','acquire','publish']){
    const store=memoryStore();store[operation]=async()=>{throw Error('PRIVATE AWS details');};const f=fixture(null,store);
    const response=await f.handler(event({q:'shoe'}));assert.equal(response.statusCode,503);assert.equal(f.calls.length,operation==='publish'?1:0);assert.ok(!response.body.includes('PRIVATE'));
  }
});
test('malformed cached payload fails closed without spending upstream credits',async()=>{
  const f=fixture();await f.handler(event({q:'shoe'}));const [key,page]=[...f.store.rows.entries()][0];page.payload.data.products='wrong';f.store.rows.set(key,page);
  const response=await f.handler(event({q:'shoe'}));assert.equal(response.statusCode,503);assert.equal(f.calls.length,1);
});
test('invalid input cannot spend credits or collapse into a different valid query',async()=>{
  const f=fixture();
  for(const params of [{},{q:''},{q:'x'.repeat(101)},{q:'shoe',section:'men'},{section:'unknown'},{q:'shoe',limit:'25'},{q:'shoe',limit:'1.5'},{q:'shoe',page_token:''},{q:'shoe',page_token:'x\n'},{q:'shoe',page_token:'x'.repeat(8193)},{q:'shoe',filters:'[]'},{q:'shoe',filters:'{"conditions":["refurbished"]}'},{q:'shoe',filters:'{"price":5}'},{q:'shoe',filters:'{"availability":["PreOrder"]}'}])assert.equal((await f.handler(event(params))).statusCode,400,JSON.stringify(params));
  assert.equal((await f.handler({...event({q:'shoe'}),rawQueryString:'q=shoe&q=coat'})).statusCode,400);
  assert.equal(f.calls.length,0);
});
test('malformed or repeated upstream cursors and product arrays never enter cache',async()=>{
  for(const upstream of [()=>({products:'bad',next_page_token:null}),()=>({products:[product('p1')],next_page_token:12}),()=>({products:[product('p1')],next_page_token:'x\n'})]){
    const f=fixture(upstream);assert.equal((await f.handler(event({q:'shoe'}))).statusCode,502);assert.equal(f.store.rows.size,0);
  }
  const f=fixture(()=>({products:[product('p1')],next_page_token:'same'}));await f.handler(event({q:'shoe'}));assert.equal((await f.handler(event({q:'shoe',page_token:'same'}))).statusCode,502);
});
test('page bounds and image host rules prevent oversized or foreign media from storage',async()=>{
  const f=fixture(()=>({products:Array.from({length:24},(_,i)=>({...product('p'+i),images:[{url:'https://evil.example/a'},{url:'https://cdn.trychannel3.com/ok.jpg'}]})),next_page_token:null}));
  const response=await f.handler(event({q:'shoe'}));assert.equal(response.statusCode,200);assert.equal(body(response).data.products.length,24);assert.equal(body(response).data.products[0].images.length,0);
  const tooMany=fixture(()=>({products:Array.from({length:25},(_,i)=>product('p'+i)),next_page_token:null}));assert.equal((await tooMany.handler(event({q:'shoe'}))).statusCode,502);
});
module.exports={memoryStore,product,event,body,fixture};

test('NFC and repeated whitespace share query identity without changing case',async()=>{
  const f=fixture();await f.handler(event({q:'  cafe\u0301   shoes '}));await f.handler(event({q:'café shoes'}));
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].query,'café shoes');
});
test('invalid UTF16 cursors and overlong filter arrays are rejected before transport',async()=>{
  const f=fixture();const request=event({q:'shoe'});delete request.rawQueryString;
  assert.equal((await f.handler({...request,queryStringParameters:{q:'shoe',page_token:'\ud800'}})).statusCode,400);
  assert.equal((await f.handler(event({q:'shoe',filters:'{"conditions":["new","used","new"]}'}))).statusCode,400);assert.equal(f.calls.length,0);
});
test('500-product traversal limit counts rejected source records and bounds the last page',async()=>{
  const f=fixture((input,n)=>({products:Array.from({length:24},()=>({id:'bad id'})),next_page_token:'page-'+n}));
  let response=body(await f.handler(event({q:'shoe'}))),round=1;
  while(response.data.next_page_token&&round<25){response=body(await f.handler(event({q:'shoe',page_token:response.data.next_page_token})));round++;}
  assert.equal(f.calls.length,21);assert.equal(response.data.next_page_token,null);
});
test('lease wait obeys six-second wall-clock budget with slow cache reads',async()=>{
  let time=0,reads=0,calls=0;const store=memoryStore();store.acquire=async()=>false;store.get=async()=>{reads++;time+=1500;return undefined;};
  const handler=createHandler({store,now:()=>time,sleep:async ms=>{time+=ms;},upstream:async()=>{calls++;return {products:[],next_page_token:null};}});
  const result=await handler(event({q:'shoe'}));assert.equal(result.statusCode,503);assert.equal(body(result).error,'CACHE_BUSY');assert.ok(time<=7500);assert.ok(reads<=5);assert.equal(calls,0);
});
test('malformed percent encoding cannot become a replacement-character query',async()=>{
  const f=fixture();for(const rawQueryString of ['q=%ED%A0%80','q=%FF','q=%2','q=shoe&page_token=%ED%A0%80'])assert.equal((await f.handler({...event({q:'shoe'}),rawQueryString})).statusCode,400);
  assert.equal(f.calls.length,0);
});
test('cursor expiry during cache reads or lease acquisition cannot spend another credit',async t=>{
  for(const stage of ['first-read','lease','raced-read','wait-read','cached-page'])await t.test(stage,async()=>{
    const f=fixture(input=>({products:[product(input.page_token?'p2':'p1')],next_page_token:input.page_token?null:'next'}));
    await f.handler(event({q:'shoe'}));f.advance(1_799_998);
    if(stage==='cached-page')await f.handler(event({q:'shoe',page_token:'next'}));
    const spent=f.calls.length,originalGet=f.store.get,originalAcquire=f.store.acquire;let pageReads=0;
    f.store.get=async key=>{
      const value=await originalGet(key);
      if(key.startsWith('page#')){
        pageReads++;
        if((['first-read','cached-page'].includes(stage)&&pageReads===1)||(['raced-read','wait-read'].includes(stage)&&pageReads===2))f.advance(3);
      }
      return value;
    };
    f.store.acquire=async(...args)=>{if(stage==='wait-read')return false;const value=await originalAcquire(...args);if(stage==='lease')f.advance(3);return value;};
    const response=await f.handler(event({q:'shoe',page_token:'next'}));
    assert.equal(response.statusCode,410);assert.equal(body(response).error,'CURSOR_EXPIRED');assert.equal(f.calls.length,spent);assert.equal(f.store.leases.size,0);
  });
});
