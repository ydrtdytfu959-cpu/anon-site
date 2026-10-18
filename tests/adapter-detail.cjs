'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const api=require('../catalog-live.js'),{product,envelope}=require('./fixtures/channel3-detail.cjs');
test('detail gallery recovers the safe cleaned image when original is unavailable',()=>{
 const p=product({images:[{url:'https://untrusted.example/image.jpg',cleaned_url:'https://cdn.trychannel3.com/cleaned.jpg',is_main_image:true}]});
 const result=api.parseChannel3Detail(envelope({},p),'shoe_1');
 assert.equal(result.images.length,1);assert.equal(result.images[0].url,'https://cdn.trychannel3.com/cleaned.jpg');
});
test('Astra detail rejects unrelated brands or sellers even on direct product URLs',()=>{
 const bad=product({brands:[{id:'b',name:'Other'}],offers:[{domain:'unapproved.example',url:'https://buy.trychannel3.com/any',price:{currency:'USD',price:10}}]});
 assert.throws(()=>api.parseChannel3Detail(envelope({},bad),'shoe_1'), e=>e.code==='catalog_not_approved');
 const viaSephora=product({brands:[{id:'b',name:'Other'}],offers:[{domain:'sephora.com',url:'https://buy.trychannel3.com/a',price:{currency:'USD',price:10}}]});
 const good=api.parseChannel3Detail(envelope({},viaSephora),'shoe_1');
 assert.equal(good.offers.length,1);assert.equal(good.offers[0].merchantDomain,'sephora.com');
 const noOutlet=product({brands:[{id:'b',name:'Other'}],offers:[{domain:'tjmaxx.com.bad.site',url:'https://buy.trychannel3.com/a'}]});
 assert.throws(()=>api.parseChannel3Detail(envelope({},noOutlet),'shoe_1'));
});
test('detail adapter keeps a full separate model with exact money and unknown quantity',()=>{
  const detail=api.parseChannel3Detail(envelope(), 'shoe_1');
  assert.equal(detail.schema,'anox.product-detail/1');assert.equal(detail.provider,'channel3');assert.equal(detail.title,'Real shoe');
  assert.equal(detail.images.length,12);assert.equal(detail.images[0].url,'https://cdn.trychannel3.com/0.jpg');assert.equal(detail.images[0].isMainImage,true);assert.ok(detail.description.length>2000);
  assert.equal(detail.offers[0].priceCents,9995);assert.equal(detail.offers[0].compareAtPriceCents,12000);assert.equal(detail.offers[0].merchantDomain,'nike.com');assert.equal(detail.offers[0].maxCommissionRate,0.05);
  assert.deepEqual(detail.offers[0].dimensions.weight,{number:0.5,unit:'kg'});assert.equal(detail.variants.options[0].values[1].productId,'shoe_red');
  assert.equal(detail.variants.options[0].values[1].availability,'unknown');assert.deepEqual(detail.variants.selected,[{name:'Color',label:'Navy Blue'}]);assert.equal(detail.stock,null);assert.equal(detail.purchasable,false);
});
test('detail keeps incomplete products selectable as data without inventing options or offers',()=>{
  const detail=api.parseChannel3Detail(envelope({},product({images:[],variants:null,description:null,materials:null,key_features:null,structured_attributes:{}})),'shoe_1');
  assert.deepEqual(detail.images,[]);assert.equal(detail.offers.length,1);assert.deepEqual(detail.variants,{options:[],selected:[]});assert.equal(detail.description,null);assert.equal(detail.stock,null);
});
test('detail rejects substitution, expired data, oversized images and inconsistent selection claims',()=>{
  for(const payload of [envelope({},product({id:'other'})),envelope({expiresAt:new Date(Date.now()-1000).toISOString()}),envelope({},product({images:Array(65).fill({url:'https://cdn.trychannel3.com/a'})}))]){
    assert.throws(()=>api.parseChannel3Detail(payload,'shoe_1'));
  }
  assert.throws(()=>api.parseChannel3Detail(envelope(),'shoe_1',{options:{Color:'Red'}}));
  const resolved=api.parseChannel3Detail(envelope({selectionMismatch:[{name:'Color',requested:'Red',effective:'Navy Blue'}]}),'shoe_1',{options:{Color:'Red'}});
  assert.equal(resolved.selectionMismatch[0].effective,'Navy Blue');
});
test('malformed option names cannot be coerced into selectable string identities',()=>{
  for(const name of [null,42,undefined])assert.throws(()=>api.parseChannel3Detail(envelope({},product({variants:{options:[{name,values:[{label:'x',exists:true}]}],selected:[]}})),'shoe_1'));
});
test('presentation-only data cannot carry offers or availability into the detail model',()=>{
  const detail=api.parseChannel3Detail(envelope({status:'presentation_only',error:'DETAIL_REFRESH_UNAVAILABLE',expiresAt:new Date(Date.now()+3600000).toISOString()}),'shoe_1');
  assert.deepEqual(detail.offers,[]);assert.ok(detail.variants.options.every(o=>o.values.every(v=>v.availability==='unknown')));assert.equal(detail.freshness.status,'presentation_only');
});
test('detail validates all selections before fetch and uses the dedicated no-store transport',async()=>{
  const calls=[],context={module:{exports:{}},URL,URLSearchParams,AbortController,TextDecoder,setTimeout,clearTimeout,fetch:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(envelope()),{headers:{'content-type':'application/json'}});}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../catalog-live.js'),'utf8'),context);const client=context.module.exports;
  const detail=await client.getChannel3Product('shoe_1',{options:{Color:'Navy Blue'}});
  assert.equal(detail.title,'Real shoe');const url=new URL(calls[0].url);assert.equal(url.pathname,'/catalog/channel3/products/shoe_1');assert.equal(url.searchParams.get('option_Color'),'Navy Blue');assert.equal(calls[0].options.cache,'no-store');
  for(const options of [{Color:'x\n'},{Color:'\u0085'},{Color:'x'.repeat(81)},JSON.parse('{"__proto__":"x"}'),{'':'x'}])await assert.rejects(client.getChannel3Product('shoe_1',{options}));
  assert.equal(calls.length,1);assert.throws(()=>client.buildChannel3DetailUrl('../bad'));assert.throws(()=>client.buildChannel3DetailUrl('shoe_1',{constructor:'x'}));
});
test('detail never accepts foreign images, links, pseudo-money or unsupported stock enums',()=>{
  const raw=product({images:[{url:'https://evil.example/img'}],offers:[{domain:'nike.com',url:'https://evil.example/buy',price:{price:99.95,currency:'USD'},availability:'InStock'},{domain:'nike.com',url:'https://buy.trychannel3.com/one',price:{price:1.001,currency:'USD'},availability:'LimitedAvailability'}]});
  const detail=api.parseChannel3Detail(envelope({},raw),'shoe_1');assert.deepEqual(detail.images,[]);assert.equal(detail.offers.length,1);assert.equal(detail.offers[0].priceCents,null);assert.equal(detail.offers[0].availability,'unknown');
});
test('actual catalog handler and browser adapter agree on fresh and presentation-only wire contracts',async()=>{
  const {createHandler}=require('../backend/index.js');let failed=false;const rows=new Map(),leases=new Map();
  const store={get:async key=>structuredClone(rows.get(key)),acquire:async(key,owner)=>{if(leases.has(key))return false;leases.set(key,owner);return true;},publish:async(key,owner,value,_cursor,_time,extra=[])=>{assert.equal(leases.get(key),owner);rows.set(key,structuredClone(value));for(const item of extra)rows.set(item.key,structuredClone(item.value));leases.delete(key);},release:async key=>leases.delete(key)};
  const handler=createHandler({store,upstreamDetail:async()=>{if(failed)throw Error('offline fixture');return product();}}),event={requestContext:{http:{method:'GET'}},rawPath:'/catalog/channel3/products/shoe_1',rawQueryString:'option_Color=Red'};
  const response=await handler(event);assert.equal(response.statusCode,200);const fresh=api.parseChannel3Detail(JSON.parse(response.body),'shoe_1',{options:{Color:'Red'}});
  assert.equal(fresh.images.length,12);assert.equal(fresh.offers[0].priceCents,9995);assert.deepEqual(fresh.selectionMismatch,[{name:'Color',requested:'Red',effective:'Navy Blue'}]);
  failed=true;const fallbackResponse=await handler(event);assert.equal(fallbackResponse.statusCode,200);
  // Offline fallback retains verified official seller identity, not prices or offer links.
  const fallback=api.parseChannel3Detail(JSON.parse(fallbackResponse.body),'shoe_1',{options:{Color:'Red'}});
  assert.equal(fallback.freshness.status,'presentation_only');
  assert.deepEqual(fallback.offers,[]);
  assert.equal(fallback.images.length,12);
});
