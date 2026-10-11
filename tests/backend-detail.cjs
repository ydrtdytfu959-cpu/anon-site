'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../backend/index.js');
const raw=(patch={})=>({id:'shoe_1',title:'Real shoe',description:'Full description '.repeat(150),brands:[{id:'b1',name:'Example'}],
  images:Array.from({length:12},(_,i)=>({url:`https://cdn.trychannel3.com/${i}.jpg`,alt_text:'View '+i,is_main_image:i===0,shot_type:'detail'})),
  offers:[{domain:'example.com',url:'https://buy.trychannel3.com/tracked?a=1',price:{price:99.95,currency:'USD'},availability:'InStock',condition:'new',max_commission_rate:0.05}],
  variants:{options:[{name:'Color',values:[{label:'Navy Blue',exists:true,available:'InStock',thumbnail_url:'https://cdn.trychannel3.com/navy.jpg',product_id:null},{label:'Red',exists:false,available:null,product_id:'shoe_red'}]}],selected:[{name:'Color',label:'Navy Blue'}]},
  materials:['Cotton'],key_features:['Cushioned'],structured_attributes:{color:['Navy Blue']},private_key:'NEVER_RETURN',...patch});
function memory(){const rows=new Map(),leases=new Map();return {rows,async get(k){return structuredClone(rows.get(k));},async acquire(k,owner,now,until){if(leases.get(k)?.until>now)return false;leases.set(k,{owner,until});return true;},async publish(k,owner,value,cursor,now,extra=[]){assert.equal(leases.get(k)?.owner,owner);assert.ok(leases.get(k).until>now);rows.set(k,structuredClone(value));for(const row of extra)rows.set(row.key,structuredClone(row.value));leases.delete(k);},async release(k,owner){if(leases.get(k)?.owner===owner)leases.delete(k);}};}
const event=(query='',id='shoe_1')=>({version:'2.0',requestContext:{http:{method:'GET'}},rawPath:'/catalog/channel3/products/'+id,rawQueryString:query});
const body=response=>JSON.parse(response.body);
function fixture(overrides={}){let time=1800000000000,calls=0;const store=memory(),handler=api.createHandler({store,upstream:async()=>{throw Error('search must not run');},upstreamDetail:async()=>{calls++;return raw();},now:()=>time,sleep:async()=>{},...overrides});return {handler,store,get calls(){return calls;},advance:n=>{time+=n;}};}

test('detail preserves full bounded gallery, variants and attribution independently from cards',async()=>{
  const f=fixture(),response=await f.handler(event());assert.equal(response.statusCode,200);
  const data=body(response);assert.equal(data.status,'fresh');assert.equal(data.data.product.images.length,12);assert.ok(data.data.product.description.length>2000);
  assert.equal(data.data.product.offers[0].max_commission_rate,0.05);assert.equal(data.data.product.variants.options[0].values[1].product_id,'shoe_red');
  assert.ok(!JSON.stringify(data).includes('NEVER_RETURN'));assert.equal(response.headers['Cache-Control'],'no-store');assert.deepEqual(data.selectionMismatch,[]);
  await f.handler(event());assert.equal(f.calls,2,'each sequential visit refreshes volatile detail');
});
test('detail options stay exact and relaxed server selections are reported',async()=>{
  let requested;const f=fixture({upstreamDetail:async input=>{requested=input;return raw();}});
  const response=await f.handler(event('option_Color=Red'));assert.equal(response.statusCode,200);
  assert.deepEqual(requested,{productId:'shoe_1',options:{Color:'Red'}});
  assert.deepEqual(body(response).selectionMismatch,[{name:'Color',requested:'Red',effective:'Navy Blue'}]);
});
test('invalid detail paths, duplicate options and public internal-operation spoofing cannot reach upstream',async()=>{
  const f=fixture();for(const request of [event('', '../shoe'),event('option_Color=Red&option_Color=Blue'),event('fresh=1'),event('option_=Red'),event('option_Color=%ED%A0%80'),event('option_Color=%C2%85'),{...event(),operation:'commerce.product',productId:'shoe_1'}])assert.ok((await f.handler(request)).statusCode>=400);
  assert.equal(f.calls,0);
});
test('internal quote retrieval is distinct from HTTP and always fresh',async()=>{
  const f=fixture();const result=await f.handler({operation:'commerce.product',productId:'shoe_1',options:{Color:'Navy Blue'}});
  assert.equal(result.provider,'channel3');assert.equal(result.status,'fresh');assert.equal(f.calls,1);
  assert.ok((await f.handler({operation:'commerce.product',productId:'shoe_1',version:'2.0'})).statusCode>=400);
});
test('presentation fallback strips all volatile offers and stock and expires after one hour',async()=>{
  let fail=false;const f=fixture({upstreamDetail:async()=>{if(fail)throw Error('private upstream diagnostic');return raw();}});
  await f.handler(event());fail=true;f.advance(1000);
  const fallback=body(await f.handler(event()));assert.equal(fallback.status,'presentation_only');assert.equal(fallback.error,'DETAIL_REFRESH_UNAVAILABLE');assert.deepEqual(fallback.data.product.offers,[]);
  assert.ok(fallback.data.product.variants.options.every(o=>o.values.every(v=>v.available===null)));
  const internal=await f.handler({operation:'commerce.product',productId:'shoe_1'});assert.equal(internal.error,'DETAIL_REFRESH_UNAVAILABLE');assert.ok(!internal.data);
  f.advance(3600000);assert.equal((await f.handler(event())).statusCode,503);
});
test('simultaneous identical detail requests coalesce but later visits never reuse volatile values',async()=>{
  let release,calls=0;const gate=new Promise(r=>release=r),f=fixture({upstreamDetail:async()=>{calls++;await gate;return raw();}});
  const a=f.handler(event()),b=f.handler(event());await Promise.resolve();release();const results=await Promise.all([a,b]);
  assert.ok(results.every(r=>r.statusCode===200));assert.equal(calls,1);await f.handler(event());assert.equal(calls,2);
});
test('oversized gallery is rejected without silently truncating and foreign identity is rejected',async()=>{
  for(const product of [raw({images:Array.from({length:65},()=>({url:'https://cdn.trychannel3.com/a.jpg'}))}),raw({id:'substitution'})]){
    const f=fixture({upstreamDetail:async()=>product});const response=await f.handler(event());assert.ok(response.statusCode>=400);assert.ok(!body(response).data);
  }
});
test('detail transport uses official GET with locale and exact options, safely handles missing product',async()=>{
  let seen;const upstream=api.createUpstream({getSecret:async()=>'fixture',fetch:async(url,options)=>{seen={url:new URL(url),options};return new Response(JSON.stringify(raw()),{headers:{'content-type':'application/json'}});}});
  await upstream.detail({productId:'shoe_1',options:{Color:'Navy Blue'}});assert.equal(seen.options.method,'GET');assert.equal(seen.url.pathname,'/v1/products/shoe_1');
  assert.equal(seen.url.searchParams.get('country'),'US');assert.equal(seen.url.searchParams.get('currency'),'USD');assert.equal(seen.url.searchParams.get('option_Color'),'Navy Blue');assert.equal(seen.options.body,undefined);
  const missing=api.createUpstream({getSecret:async()=>'fixture',fetch:async()=>new Response('private',{status:404})});await assert.rejects(missing.detail({productId:'shoe_1',options:{}}),e=>e.status===404&&e.code==='PRODUCT_NOT_FOUND');
});

test('distributed detail waiters share only a result completed after their own request began',async()=>{
  let time=1800000000000,calls=0,release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),store=memory();
  const setup=()=>api.createHandler({store,now:()=>time,sleep:async()=>new Promise(r=>setImmediate(r)),upstream:async()=>{throw Error('wrong path');},upstreamDetail:async()=>{calls++;entered();if(calls===1)await gate;time++;return raw();}});
  const first=setup(),second=setup(),a=first(event());await Promise.race([started,a.then(result=>assert.equal(result.statusCode,200))]);const b=second(event());await new Promise(r=>setImmediate(r));release();
  assert.ok((await Promise.all([a,b])).every(result=>result.statusCode===200));assert.equal(calls,1);
  await second(event());assert.equal(calls,2,'even a same-millisecond later visit must refresh');
});
test('detail cache never persists offers or availability in the one-hour fallback row',async()=>{
  const f=fixture();await f.handler(event());const rows=[...f.store.rows.values()];assert.equal(rows.length,2);
  const presentation=rows.find(row=>row.kind==='presentation');assert.ok(presentation);assert.equal(presentation.expiresAtMs-Date.parse(presentation.payload.fetchedAt),3600000);
  assert.ok(!JSON.stringify(presentation).includes('buy.trychannel3.com'));assert.ok(!JSON.stringify(presentation).includes('InStock'));assert.equal(rows.find(row=>row.kind==='detail').expiresAtMs-Date.parse(presentation.payload.fetchedAt),30000);
});
test('missing product never uses presentation fallback and cache corruption cannot trigger detail HTTP',async()=>{
  let missing=false,calls=0;const f=fixture({upstreamDetail:async()=>{calls++;if(missing)throw Object.assign(Error('private'),{status:404,code:'PRODUCT_NOT_FOUND'});return raw();}});
  await f.handler(event());missing=true;assert.equal((await f.handler(event())).statusCode,404);
  const row=[...f.store.rows.values()].find(row=>row.kind==='detail');row.payload.data.product.id='wrong';const pair=[...f.store.rows.entries()].find(([,value])=>value.kind==='detail');f.store.rows.set(pair[0],row);
  const spent=calls;assert.equal((await f.handler(event())).statusCode,503);assert.equal(calls,spent);
});
test('untrusted detail records cannot manufacture selection identity or integer inventory',async()=>{
  const variants={options:[{name:'Color',values:[{label:'Navy Blue',exists:true},{label:'Navy Blue',exists:true}]}],selected:[{name:'Color',label:'Navy Blue'}]};
  const f=fixture({upstreamDetail:async()=>raw({variants})});assert.equal((await f.handler(event())).statusCode,503);
  const clean=fixture({upstreamDetail:async()=>raw({stock:10,quantity:100,offers:[],variants:null,description:null})});const payload=body(await clean.handler(event()));assert.equal(payload.status,'fresh');assert.deepEqual(payload.data.product.offers,[]);assert.equal(payload.data.product.variants,null);assert.equal(payload.data.product.stock,undefined);
});
test('a request arriving after detail fetch completion cannot coalesce during a slow cache write',async()=>{
  let time=1800000000000,calls=0,release,entered;const store=memory(),gate=new Promise(r=>release=r),publishing=new Promise(r=>entered=r),originalPublish=store.publish;
  store.publish=async(...args)=>{if(calls===1){entered();await gate;}return originalPublish(...args);};
  const handler=api.createHandler({store,now:()=>time,upstreamDetail:async()=>{calls++;return raw();}}),first=handler(event());await publishing;time+=100;
  const later=handler({operation:'commerce.product',productId:'shoe_1'});release();await first;const result=await later;
  assert.equal(result.status,'fresh');assert.equal(calls,2);assert.equal(Date.parse(result.fetchedAt),time);
});
test('a later local waiter cannot inherit another request eligibility for a distributed exchange',async()=>{
  let time=1800000000100;const store=memory();const initial=api.createHandler({store,now:()=>time,upstreamDetail:async()=>raw()});await initial(event());
  let release,entered,calls=0;const gate=new Promise(r=>release=r),reading=new Promise(r=>entered=r),originalGet=store.get;store.get=async key=>{entered();await gate;return originalGet(key);};
  const handler=api.createHandler({store,now:()=>time,upstreamDetail:async()=>{calls++;return raw();}});time-=50;const earlier=handler(event());await reading;time+=100;
  const later=handler({operation:'commerce.product',productId:'shoe_1'});release();assert.equal((await earlier).statusCode,200);const result=await later;
  assert.notEqual(result.status,'fresh');assert.equal(result.error,'CACHE_BUSY');assert.equal(calls,0);
});
