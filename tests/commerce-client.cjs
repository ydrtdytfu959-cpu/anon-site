'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'../commerce-client.js');
const lib=fs.existsSync(file)?require(file):{};
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
function locks(){let tail=Promise.resolve();return {request:(_name,_options,fn)=>{const pending=tail.then(fn);tail=pending.catch(()=>{});return pending;}};}
const item=(options={Color:'Blue',Size:'M'})=>({provider:'channel3',productId:'real-product',offerUrl:'https://buy.trychannel3.com/real',options,quantity:2,display:{title:'Actual product',merchantDomain:'nike.com',priceCents:12345,currency:'USD',imageUrl:'https://cdn.trychannel3.com/real.png',stock:null,maxCommissionRate:0.02}});

test('production selections restore without inventing stock or trusting extra purchase fields',async()=>{
  assert.equal(typeof lib.createCart,'function');
  const storage=memory(),lock=locks(),cart=lib.createCart({storage,locks:lock});
  await cart.add({...item(),paid:true,purchasable:true});
  const restored=lib.createCart({storage,locks:lock});
  assert.equal(restored.state.lines.length,1);assert.equal(restored.state.lines[0].quantity,2);
  assert.equal(restored.state.lines[0].display.stock,null);assert.equal(restored.state.lines[0].paid,undefined);
  assert.equal(restored.state.lines[0].display.maxCommissionRate,0.02);
  assert.equal(restored.state.lines[0].offerUrl,'https://buy.trychannel3.com/real');
});
test('cooperating tabs merge cart additions using fresh persisted state and reject stale edits',async()=>{
  assert.equal(typeof lib.createCart,'function');
  const storage=memory(),lock=locks(),a=lib.createCart({storage,locks:lock}),b=lib.createCart({storage,locks:lock});
  await Promise.all([a.add(item()),b.add(item({Size:'L',Color:'Blue'}))]);
  a.reload();assert.equal(a.state.lines.length,2);
  const line=a.state.lines[0],key=lib.lineKey(line);await b.update(key,{quantity:4},line);
  await assert.rejects(a.update(key,{quantity:3},line),{code:'cart_changed'});
  a.reload();assert.equal(a.state.lines[0].quantity,4);
});
test('cart rejects unsafe option keys, invalid quantities, and over-limit combined quantities',async()=>{
  assert.equal(typeof lib.createCart,'function');
  const cart=lib.createCart({storage:memory(),locks:locks()});
  await assert.rejects(cart.add({...item(),quantity:0}),{code:'invalid_selection'});
  await assert.rejects(cart.add({...item(),options:JSON.parse('{"__proto__":"bad"}')}),{code:'invalid_selection'});
  await cart.add({...item(),quantity:20});await assert.rejects(cart.add(item()),{code:'cart_quantity_limit'});
  assert.equal(cart.state.lines[0].quantity,20);
});
test('uncoordinated or denied persistence remains explicit session-only storage',async()=>{
  assert.equal(typeof lib.createCart,'function');
  const storage=memory(),cart=lib.createCart({storage});await cart.add(item());
  assert.equal(cart.state.persistent,false);assert.equal(lib.createCart({storage}).state.lines.length,0);
  const denied=lib.createCart({storage:{getItem(){throw Error('denied');},setItem(){throw Error('denied');}},locks:locks()});
  await denied.add(item());assert.equal(denied.state.lines.length,1);assert.equal(denied.state.persistent,false);
});

function quoted(revision='rev-one',now=Date.now()) { return {schemaVersion:1,quote:{quoteId:'quote-1',cartRevision:revision,cartHash:'a'.repeat(64),destination:{country:'DZ'},currency:'USD',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+30000).toISOString(),lines:[{provider:'channel3',productId:'real-product',merchantDomain:'nike.com',condition:null,quantity:2,options:{Color:'Blue',Size:'M'},title:'Actual product',unitPriceMinor:12345,lineTotalMinor:24690,currency:'USD',availability:'InStock',validatedAt:new Date(now).toISOString(),offer:{domain:'nike.com',url:'https://buy.trychannel3.com/real',maxCommissionRate:0.02},selection:{valid:true}}],costs:{components:[{code:'products',label:'Product price',status:'estimated',amountMinor:24690,currency:'USD',source:'catalog'},{code:'anox_service_fee',label:'AnoX service fee',status:'conditional',amountMinor:500,currency:'USD',source:'anox'},{code:'international_shipping',label:'International shipping',status:'unknown',amountMinor:null,currency:'USD',source:'unavailable'}],estimatedTotalMinor:null,verifiedPayableTotalMinor:null,potentialChargesOnArrival:[{code:'customs_duties',label:'Customs duties',status:'unknown',amountMinor:null,currency:'USD',source:'unavailable'}]},checkout:{enabled:false,blockers:[{code:'MERCHANT_CHECKOUT_UNAVAILABLE',message:'No authorized merchant purchasing integration is connected.'}]}}}; }
test('quote requests exclude browser price metadata, coalesce and reuse the key on uncertain retry',async()=>{
  assert.equal(typeof lib.createClient,'function');
  const calls=[],auth={api:async(path,options)=>{calls.push({path,options});if(calls.length===1)throw Error('network');return quoted();}},client=lib.createClient({auth});
  const cart={revision:'rev-one',lines:[lib.selection(item())]};
  await assert.rejects(client.requestQuote(cart));
  const one=client.requestQuote(cart),two=client.requestQuote(cart);assert.equal(one,two);await one;
  assert.equal(calls[0].options.idempotencyKey,calls[1].options.idempotencyKey);
  assert.deepEqual(JSON.parse(calls[1].options.body),{cartRevision:'rev-one',lines:[{provider:'channel3',productId:'real-product',merchantDomain:'nike.com',condition:null,quantity:2,options:{Color:'Blue',Size:'M'}}],destination:{country:'DZ'},currency:'USD'});
  assert.equal(client.state.quote.costs.verifiedPayableTotalMinor,null);assert.equal(client.canCheckout(cart),false);
});
test('quote mismatches, invalid fee, expiry and client invalidation never enable payment',async()=>{
  assert.equal(typeof lib.createClient,'function');
  let response=quoted(),now=Date.now(),resolve;
  const cart={revision:'rev-one',lines:[lib.selection(item())]},client=lib.createClient({auth:{api:async()=>response},now:()=>now});
  response=quoted();response.quote.cartRevision='other';await assert.rejects(client.requestQuote(cart),{code:'invalid_quote'});
  client.invalidate();response=quoted();response.quote.costs.components[1].amountMinor=750;await assert.rejects(client.requestQuote(cart),{code:'invalid_quote'});
  client.invalidate();response=quoted();await client.requestQuote(cart);now+=901000;assert.equal(client.currentQuote(cart),null);
  const late=lib.createClient({auth:{api:()=>new Promise(r=>resolve=r)}}),pending=late.requestQuote(cart);await Promise.resolve();late.invalidate();resolve(quoted());await pending;assert.equal(late.state.quote,null);
});

test('cart option and identity validation rejects ill-formed Unicode and invalid metadata without mutation',async()=>{
 const cart=lib.createCart({storage:memory(),locks:locks()});
 for(const options of [{Size:'\ud800'},{Size:'\udfff'},{'\u0085Size':'M'},{Size:'M\u009f'}]) await assert.rejects(cart.add({...item(),options}),{code:'invalid_selection'});
 for(const patch of [{condition:'refurbished'},{merchantDomain:'nike.com/path'},{productId:'../real'}]) await assert.rejects(cart.add({...item(),...patch}),{code:'invalid_selection'});
 await cart.add(item({Color:'🟦 Blue',Size:'M'}));assert.equal(cart.state.lines.length,1);
});

test('corrupt restoration does not silently overwrite persisted selections and alerts about partial recovery',async()=>{
 const storage=memory();storage.setItem('anox:selection-cart:v1','{broken');
 const cart=lib.createCart({storage,locks:locks()});await cart.add(item());
 assert.equal(cart.state.persistent,false);assert.equal(storage.getItem('anox:selection-cart:v1'),'{broken');
 storage.setItem('anox:selection-cart:v1',JSON.stringify({schema:'anox.selection-cart/1',revision:'saved-id',lines:[item(),{productId:'missing'}]}));
 const partial=lib.createCart({storage,locks:locks()});assert.equal(partial.state.lines.length,1);assert.equal(partial.state.notice,'cart_restoration_incomplete');
});

test('quote validation refuses unknown costs with totals, invalid statuses, malformed expiry and wrong lines',()=>{
 const cart={revision:'rev-one',lines:[lib.selection(item())]};
 for(const mutate of [q=>q.costs.estimatedTotalMinor=25190,q=>q.costs.verifiedPayableTotalMinor=25190,q=>q.costs.components[0].status='paid',q=>q.expiresAt='invalid',q=>q.createdAt='invalid',q=>q.lines=[],q=>q.lines[0].quantity=1,q=>q.lines[0].options.Size='L',q=>q.checkout.enabled=true,q=>q.costs.components.push({...q.costs.components[1]})]){
  const value=quoted();mutate(value.quote);assert.throws(()=>lib.quoteShape(value,cart.revision,Date.now(),cart.lines),{code:'invalid_quote'});
 }
});
test('new account or edited cart invalidates late quote without needing a UI event',async()=>{
 let version=1,respond;const auth={sessionVersion:()=>version,state:{session:{}},api:()=>new Promise(r=>respond=r)},client=lib.createClient({auth});
 const cart={revision:'rev-one',lines:[lib.selection(item())]};let pending=client.requestQuote(cart);await Promise.resolve();version++;respond(quoted());await pending;assert.equal(client.currentQuote(cart),null);
 pending=client.requestQuote(cart);await Promise.resolve();cart.revision='rev-two';respond(quoted());await pending;assert.equal(client.currentQuote(cart),null);
});
test('expired quotes use new idempotency keys on an explicit refresh',async()=>{
 let now=Date.now();const calls=[],cart={revision:'rev-one',lines:[lib.selection(item())]},client=lib.createClient({auth:{api:async(_p,options)=>{calls.push(options);return quoted(cart.revision,now);}},now:()=>now});
 await client.requestQuote(cart);now+=901000;await client.requestQuote(cart);assert.notEqual(calls[0].idempotencyKey,calls[1].idempotencyKey);
});

test('valid quote is accepted only for matching authoritative line identities',()=>{const cart={revision:'rev-one',lines:[lib.selection(item())]};assert.equal(lib.quoteShape(quoted(),cart.revision,Date.now(),cart.lines).lines[0].lineTotalMinor,24690);});

test('capabilities cannot enable checkout and quote limits report every offending selection',()=>{
 const valid={schemaVersion:1,quote:{enabled:true,limits:{maxLines:10,maxDistinctProducts:5,maxQuantityPerLine:20}},checkout:{enabled:false,blockers:[{code:'MERCHANT_CHECKOUT_UNAVAILABLE',message:'Not connected'}]},orders:{read:true,cancel:false,refund:false},serviceFee:{currency:'USD',amountMinor:500,appliesOn:'successful_order'}};
 assert.equal(lib.capabilitiesShape(valid).checkout.enabled,false);assert.throws(()=>lib.capabilitiesShape({...valid,checkout:{...valid.checkout,enabled:true}}));
 assert.equal(lib.quoteLimits({lines:Array.from({length:11},(_,i)=>({...lib.selection(item()),productId:'product-'+i}))}).length,2);
});
test('server order normalization accepts only owned-route status data and never redirect flags',()=>{
 const order={orderId:'order-1',totalMinor:25190,currency:'USD',createdAt:new Date().toISOString(),status:'confirmed',payment:{status:'succeeded'},fulfillment:{status:'pending'},capabilities:{cancel:false,refund:false}};
 assert.equal(lib.orderShape({schemaVersion:1,order}).payment.status,'succeeded');
 assert.throws(()=>lib.orderShape({schemaVersion:1,order:{...order,status:'paid_from_url'}}),{code:'invalid_order'});
 assert.throws(()=>lib.orderShape({schemaVersion:1,order:{...order,payment:{status:'maybe'}}}),{code:'invalid_order'});
});

test('explicit browser-data clearing removes even corrupt cart storage and reports a denied erase',async()=>{
 const storage=memory();storage.setItem('anox:selection-cart:v1','{corrupt');const cart=lib.createCart({storage,locks:locks()});await cart.add(item());
 await cart.forget();assert.equal(storage.getItem(cart.key),null);assert.equal(cart.state.lines.length,0);
 const denied=lib.createCart({storage:{getItem(){return '{corrupt';},removeItem(){throw Error('denied');}},locks:locks()});await denied.add(item());await assert.rejects(denied.forget());assert.equal(denied.state.lines.length,1);
});

test('explicit erase cancels queued edits so an earlier pending add cannot restore deleted cart data',async()=>{
 const storage=memory(),cart=lib.createCart({storage,locks:locks()});
 const pending=cart.add(item()),rejected=assert.rejects(pending,{code:'cart_changed'});await cart.forget();await rejected;
 assert.equal(storage.getItem(cart.key),null);assert.equal(cart.state.lines.length,0);
});

test('quote response product subtotal must equal the exact sum of its server line amounts',()=>{
 const cart={revision:'rev-one',lines:[lib.selection(item())]};
 for(const mutate of [q=>q.costs.components[0].amountMinor++,q=>q.costs.components.shift(),q=>q.costs.components[0].status='verified']){
  const response=quoted();mutate(response.quote);assert.throws(()=>lib.quoteShape(response,cart.revision,Date.now(),cart.lines),{code:'invalid_quote'});
 }
});

 test('quote response cannot outlive thirty-second product evidence or reuse stale line evidence',()=>{
 const now=Date.now(),cart={revision:'rev-one',lines:[lib.selection(item())]};
 for(const mutate of [q=>q.expiresAt=new Date(now+30001).toISOString(),q=>q.lines[0].validatedAt=new Date(now-30001).toISOString(),q=>q.lines[0].validatedAt=new Date(now+10001).toISOString()]){
  const response=quoted(cart.revision,now);mutate(response.quote);assert.throws(()=>lib.quoteShape(response,cart.revision,now,cart.lines),{code:'invalid_quote'});
 }
});

test('missing attribution URL does not hide an otherwise valid read-only quote',()=>{
 const value=quoted();value.quote.lines[0].offer.url=null;
 assert.equal(lib.quoteShape(value,'rev-one',Date.now()).lines[0].offer.url,null);
});
test('quote and cart boundaries reject numeric product identifiers and malformed hash or destination',()=>{
 assert.throws(()=>lib.selection({...item(),productId:12345}),{code:'invalid_selection'});
 for(const mutate of [q=>q.cartHash='not-a-hash',q=>q.destination={country:'US'}]){
  const value=quoted();mutate(value.quote);assert.throws(()=>lib.quoteShape(value,'rev-one',Date.now()),{code:'invalid_quote'});
 }
});
function serviceResult() {
 const q=quoted().quote;
 q.lines=q.lines.map(line=>({...line,availability:'unknown',priceStatus:'historical_estimate',capturedAt:line.validatedAt,offer:{...line.offer,url:null,maxCommissionRate:null}}));
 q.costs.components.find(c=>c.code==='products').note='Historical product price estimate, not current price or stock.';
 return {schemaVersion:1,serviceRequest:{orderId:'service_request_1',kind:'service_request',status:'received',createdAt:q.createdAt,updatedAt:q.createdAt,quoteId:q.quoteId,cartRevision:q.cartRevision,cartHash:q.cartHash,currency:'USD',totalMinor:null,destination:{country:'DZ'},lines:q.lines,costs:q.costs,serviceFee:{currency:'USD',amountMinor:500,appliesOn:'owner_decision_pending',collectionEnabled:false},payment:{status:'not_requested'},fulfillment:{status:'not_requested',tracking:[]},merchantOrderReference:null,capabilities:{cancel:false,refund:false}}};
}
function serviceCapabilities(){return {schemaVersion:1,quote:{enabled:true,limits:{maxLines:10,maxDistinctProducts:5,maxQuantityPerLine:20}},checkout:{enabled:false,blockers:[{code:'unavailable',message:'No merchant purchasing integration'}]},orders:{read:true,cancel:false,refund:false},serviceRequests:{create:true,read:true,paymentRequired:false},serviceFee:{currency:'USD',amountMinor:500,appliesOn:'owner_decision_pending',collectionEnabled:false}};}
test('new service capabilities preserve unresolved fee while older servers default to unavailable requests',()=>{
 assert.equal(lib.capabilitiesShape(serviceCapabilities()).serviceRequests.create,true);
 const legacy=serviceCapabilities();delete legacy.serviceRequests;legacy.serviceFee={currency:'USD',amountMinor:500,appliesOn:'successful_order'};
 const normalized=lib.capabilitiesShape(legacy);assert.equal(normalized.serviceRequests.create,false);assert.equal(normalized.serviceFee.appliesOn,'owner_decision_pending');
 const unsafe=serviceCapabilities();unsafe.serviceFee.collectionEnabled=true;assert.throws(()=>lib.capabilitiesShape(unsafe),{code:'invalid_capabilities'});
});
test('service requests bind reviewed quote, coalesce retry and never transmit browser money or purchase claims',async()=>{
 const calls=[];let serviceCalls=0;
 const auth={config:{apiBase:'https://api.example'},api:async(path,options)=>{calls.push({path,options});if(path==='/commerce/quotes')return quoted();if(++serviceCalls===1)throw Error('network');return serviceResult();}};
 const client=lib.createClient({auth,fetch:async()=>new Response(JSON.stringify(serviceCapabilities()))}),cart={revision:'rev-one',lines:[lib.selection(item())]};
 await client.capabilities();await client.requestQuote(cart);
 await assert.rejects(client.requestService(cart));
 const first=client.requestService(cart),second=client.requestService(cart);assert.equal(first,second);
 const result=await first;assert.equal(result.orderId,'service_request_1');assert.equal(result.payment.status,'not_requested');
 assert.equal(calls[1].options.idempotencyKey,calls[2].options.idempotencyKey);
 assert.deepEqual(JSON.parse(calls[2].options.body),{quoteId:'quote-1',cartRevision:'rev-one',cartHash:'a'.repeat(64)});
 assert.equal(await client.requestService(cart),result);assert.equal(serviceCalls,2);assert.equal(client.canCheckout(),false);
});
test('service request normalization rejects invented payment, total, shipment and mismatched reference claims',()=>{
 const result=serviceResult();assert.equal(lib.orderShape({schemaVersion:1,order:result.serviceRequest}).amountMinor,null);
 for(const mutate of [r=>r.payment.status='succeeded',r=>r.totalMinor=500,r=>r.fulfillment.status='shipped',r=>r.fulfillment.tracking=[{carrier:'USPS'}],r=>r.serviceFee.collectionEnabled=true,r=>r.merchantOrderReference='purchase1',r=>r.destination.country='US',r=>r.lines[0].quantity=10]){
  const value=serviceResult();mutate(value.serviceRequest);assert.throws(()=>lib.serviceRequestShape(value),{code:'invalid_service_request'});
 }
 const mismatched=serviceResult();assert.throws(()=>lib.serviceRequestShape(mismatched,{quoteId:'other',cartRevision:'rev-one',cartHash:'a'.repeat(64)}),{code:'invalid_service_request'});
});
test('late service-request response is discarded after account or cart changes',async()=>{
 for(const changed of ['account','cart']){
  let version=1,respond;
  const cart={revision:'rev-one',lines:[lib.selection(item())]},auth={config:{apiBase:'https://api.example'},sessionVersion:()=>version,state:{session:{}},api:async(path)=>path==='/commerce/quotes'?quoted():new Promise(r=>respond=r)};
  const client=lib.createClient({auth,fetch:async()=>new Response(JSON.stringify(serviceCapabilities()))});
  await client.capabilities();await client.requestQuote(cart);const pending=client.requestService(cart);await Promise.resolve();
  if(changed==='account')version++;else cart.revision='edited';respond(serviceResult());
  assert.equal(await pending,null);assert.equal(client.state.serviceRequest,null);
 }
});
test('saved service references require historical price labels and reject volatile offer metadata',()=>{
 const value=serviceResult(),line=lib.serviceRequestShape(value).lines[0];
 assert.equal(line.priceStatus,'historical_estimate');assert.equal(line.capturedAt,line.validatedAt);
 assert.equal(line.offer.url,null);assert.equal(line.offer.maxCommissionRate,null);assert.equal(line.availability,'unknown');
 for(const mutate of [l=>l.offer.url='https://buy.trychannel3.com/old',l=>l.offer.maxCommissionRate=0.02,l=>l.availability='InStock',l=>delete l.priceStatus,l=>l.capturedAt='invalid']){
  const input=serviceResult();mutate(input.serviceRequest.lines[0]);assert.throws(()=>lib.serviceRequestShape(input),{code:'invalid_service_request'});
 }
});
test('account change before a queued service call prevents submission under another session',async()=>{
 let version=1,serviceCalls=0;
 const cart={revision:'rev-one',lines:[lib.selection(item())]},auth={config:{apiBase:'https://api.example'},sessionVersion:()=>version,state:{session:{}},api:async(path)=>{if(path==='/commerce/quotes')return quoted();serviceCalls++;return serviceResult();}};
 const client=lib.createClient({auth,fetch:async()=>new Response(JSON.stringify(serviceCapabilities()))});
 await client.capabilities();await client.requestQuote(cart);const pending=client.requestService(cart);version++;
 assert.equal(await pending,null);assert.equal(serviceCalls,0);
});
test('uncertain service response retries the same operation after quote expiry',async()=>{
 let now=Date.now(),calls=0;const keys=[];
 const cart={revision:'rev-one',lines:[lib.selection(item())]},auth={config:{apiBase:'https://api.example'},api:async(path,options)=>{if(path==='/commerce/quotes')return quoted(cart.revision,now);keys.push(options.idempotencyKey);if(++calls===1)throw Error('network');return serviceResult();}};
 const client=lib.createClient({auth,now:()=>now,fetch:async()=>new Response(JSON.stringify(serviceCapabilities()))});
 await client.capabilities();await client.requestQuote(cart);await assert.rejects(client.requestService(cart));now+=60000;
 assert.equal((await client.requestService(cart)).orderId,'service_request_1');assert.equal(keys[0],keys[1]);
});
test('account change before a queued quote prevents upstream work under another session',async()=>{
 let version=1,calls=0;
 const cart={revision:'rev-one',lines:[lib.selection(item())]},auth={sessionVersion:()=>version,state:{session:{}},api:async()=>{calls++;return quoted();}};
 const client=lib.createClient({auth}),pending=client.requestQuote(cart);version++;
 assert.equal(await pending,null);assert.equal(calls,0);
});
test('definitive quote rejection lets a refreshed quote start a new service request',async()=>{
 for(const [code,status] of [['quote_expired',409],['quote_not_found',404],['cart_changed',409]]){
  let quoteCount=0;const submitted=[];
  const cart={revision:'rev-one',lines:[lib.selection(item())]};
  const auth={config:{apiBase:'https://api.example'},api:async(path,options)=>{
   if(path==='/commerce/quotes'){const value=quoted();value.quote.quoteId='quote-'+(++quoteCount);return value;}
   const body=JSON.parse(options.body);submitted.push({body,key:options.idempotencyKey});
   if(submitted.length===1)throw Object.assign(Error(code),{code,status});
   const result=serviceResult();result.serviceRequest.quoteId=body.quoteId;return result;
  }};
  const client=lib.createClient({auth,fetch:async()=>new Response(JSON.stringify(serviceCapabilities()))});
  await client.capabilities();await client.requestQuote(cart);await assert.rejects(client.requestService(cart),{code});
  assert.equal(client.state.serviceRequestRetryable,false,code);
  await client.requestQuote(cart);const saved=await client.requestService(cart);
  assert.equal(submitted[0].body.quoteId,'quote-1');assert.equal(submitted[1].body.quoteId,'quote-2',code);
  assert.notEqual(submitted[0].key,submitted[1].key,code);assert.equal(saved.quoteId,'quote-2');assert.equal(client.state.serviceRequestRetryable,false);
 }
});
test('uncertain service failures keep the original body and key even after a quote refresh',async()=>{
 for(const failure of [Error('network'),Object.assign(Error('service_unavailable'),{code:'service_unavailable',status:503}),Object.assign(Error('misclassified'),{code:'quote_expired',status:503}),Object.assign(Error('local'),{code:'quote_expired'})]){
  let quoteCount=0;const submitted=[];
  const cart={revision:'rev-one',lines:[lib.selection(item())]};
  const auth={config:{apiBase:'https://api.example'},api:async(path,options)=>{
   if(path==='/commerce/quotes'){const value=quoted();value.quote.quoteId='quote-'+(++quoteCount);return value;}
   const body=JSON.parse(options.body);submitted.push({body,key:options.idempotencyKey});if(submitted.length===1)throw failure;
   const result=serviceResult();result.serviceRequest.quoteId=body.quoteId;return result;
  }};
  const client=lib.createClient({auth,fetch:async()=>new Response(JSON.stringify(serviceCapabilities()))});
  await client.capabilities();await client.requestQuote(cart);await assert.rejects(client.requestService(cart));assert.equal(client.state.serviceRequestRetryable,true);await client.requestQuote(cart);
  const saved=await client.requestService(cart);assert.equal(saved.quoteId,'quote-1');assert.equal(client.state.serviceRequestRetryable,false);client.invalidate();assert.equal(client.state.serviceRequestRetryable,false);assert.deepEqual(submitted[1],submitted[0]);
 }
});
