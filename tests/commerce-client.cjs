'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'../commerce-client.js');
const lib=fs.existsSync(file)?require(file):{};
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
function locks(){let tail=Promise.resolve();return {request:(_name,_options,fn)=>{const pending=tail.then(fn);tail=pending.catch(()=>{});return pending;}};}
const item=(options={Color:'Blue',Size:'M'})=>({provider:'channel3',productId:'real-product',offerUrl:'https://buy.trychannel3.com/real',options,quantity:2,display:{title:'Actual product',merchantDomain:'merchant.example',priceCents:12345,currency:'USD',imageUrl:'https://cdn.trychannel3.com/real.png',stock:null,maxCommissionRate:0.02}});

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

function quoted(revision='rev-one',now=Date.now()) { return {schemaVersion:1,quote:{quoteId:'quote-1',cartRevision:revision,cartHash:'abc123',currency:'USD',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+30000).toISOString(),lines:[{provider:'channel3',productId:'real-product',merchantDomain:'merchant.example',condition:null,quantity:2,options:{Color:'Blue',Size:'M'},title:'Actual product',unitPriceMinor:12345,lineTotalMinor:24690,currency:'USD',availability:'InStock',validatedAt:new Date(now).toISOString(),offer:{domain:'merchant.example',url:'https://buy.trychannel3.com/real',maxCommissionRate:0.02},selection:{valid:true}}],costs:{components:[{code:'products',label:'Product price',status:'estimated',amountMinor:24690,currency:'USD',source:'catalog'},{code:'anox_service_fee',label:'AnoX service fee',status:'conditional',amountMinor:500,currency:'USD',source:'anox'},{code:'international_shipping',label:'International shipping',status:'unknown',amountMinor:null,currency:'USD',source:'unavailable'}],estimatedTotalMinor:null,verifiedPayableTotalMinor:null,potentialChargesOnArrival:[{code:'customs_duties',label:'Customs duties',status:'unknown',amountMinor:null,currency:'USD',source:'unavailable'}]},checkout:{enabled:false,blockers:[{code:'MERCHANT_CHECKOUT_UNAVAILABLE',message:'No authorized merchant purchasing integration is connected.'}]}}}; }
test('quote requests exclude browser price metadata, coalesce and reuse the key on uncertain retry',async()=>{
  assert.equal(typeof lib.createClient,'function');
  const calls=[],auth={api:async(path,options)=>{calls.push({path,options});if(calls.length===1)throw Error('network');return quoted();}},client=lib.createClient({auth});
  const cart={revision:'rev-one',lines:[lib.selection(item())]};
  await assert.rejects(client.requestQuote(cart));
  const one=client.requestQuote(cart),two=client.requestQuote(cart);assert.equal(one,two);await one;
  assert.equal(calls[0].options.idempotencyKey,calls[1].options.idempotencyKey);
  assert.deepEqual(JSON.parse(calls[1].options.body),{cartRevision:'rev-one',lines:[{provider:'channel3',productId:'real-product',merchantDomain:'merchant.example',condition:null,quantity:2,options:{Color:'Blue',Size:'M'}}],destination:{country:'DZ'},currency:'USD'});
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
 for(const patch of [{condition:'refurbished'},{merchantDomain:'merchant.example/path'},{productId:'../real'}]) await assert.rejects(cart.add({...item(),...patch}),{code:'invalid_selection'});
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
