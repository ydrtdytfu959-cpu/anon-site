#!/usr/bin/env node
'use strict';
// Full shipped HTML and its strict CSP, with local provider/auth fixtures only.
// No live product lookup, customer data, order, payment or network financial calls.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const engines=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const fixture=require('../tests/fixtures/channel3-detail.cjs');
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64');
const favicon=fs.readFileSync(path.join(root,'favicon.svg'),'utf8');assert.match(favicon,/<svg\b/);
const checks=[];
const {createHandler}=require('../backend/commerce/index.js');
const {MemoryStore,event:backendEvent,config}=require('../tests/helpers/commerce.cjs');
function detail(id,options={}){
  const size=options.Size||'M',color=options.Color||'Navy Blue';
  const d=fixture.product({id,title:'Fixture product '+id,description:'A full, real source description.\n'+('Detailed product information. '.repeat(120)),
    variants:{options:[{name:'Color',values:[{label:'Navy Blue',exists:true,available:'InStock'},{label:'Red',exists:true,available:'InStock'}]},{name:'Size',values:[{label:'M',exists:true,available:'InStock'},{label:'L',exists:true,available:'InStock'},{label:'Sold out',exists:true,available:'OutOfStock'}]}],selected:[{name:'Color',label:color},{name:'Size',label:id==='relaxed'?'M':size}]}});
  if(id==='incomplete'){d.images=[];d.description=null;d.variants={options:[],selected:[]};d.offers=[];d.materials=[];d.key_features=[];d.structured_attributes={};}
  if(id==='image-failure')d.images[0].url='https://cdn.trychannel3.com/fail0.jpg';
  if(id==='other-merchant')d.offers[0].domain='replacement.example';
  if(id==='two-merchants')d.offers.push({...d.offers[0],domain:'second.example',url:'https://buy.trychannel3.com/second',price:{price:104.95,currency:'USD'}});
  if(id==='ambiguous')d.offers.push({...d.offers[0],url:'https://buy.trychannel3.com/other',price:{price:104.95,currency:'USD'}});
  if(id==='unknown-variant')d.variants.options[1].values[0].available=null;
  if(id==='variant-source')d.variants.options[0].values[1].product_id='variant-target';
  return fixture.envelope({selectionMismatch:id==='relaxed'&&size!=='M'?[{name:'Size',requested:size,effective:'M'}]:[]},d);
}
const ownedOrder={orderId:'owned-order',createdAt:'2026-10-09T12:00:00.000Z',status:'pending',totalMinor:29985,currency:'USD',payment:{status:'pending'},fulfillment:{status:'unfulfilled'},capabilities:{cancel:false,refund:false}};
async function run(engine,mobile=false){
 const browser=await engines[engine].launch();
 try{
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:960},isMobile:engine==='firefox'?false:mobile,hasTouch:mobile,reducedMotion:'reduce'});
  const store=new MemoryStore();store.seed('customer-a','order',ownedOrder.orderId,ownedOrder);
  const handleCommerce=createHandler({store,catalog:{freshProduct:async({productId,options})=>{const value=detail(productId,options);value.data.product.offers.forEach(offer=>{offer.price.price=104.95;});return value;}},config,now:Date.now,logger:{error(){}}});
  const calls=[],errors=[],unexpected=[];let releaseSlow,slowGate=new Promise(r=>releaseSlow=r),failOnce=true,slowQuote=false,releaseQuote,quoteGate,capabilityAbsentOnce=true;
  await context.addInitScript(()=>{
   window.__commerceCsp=[];window.addEventListener('securitypolicyviolation',e=>window.__commerceCsp.push(e.violatedDirective));
   if(location.hostname==='anox.app'&&!sessionStorage.getItem('fixture-session-initialized')){sessionStorage.setItem('fixture-session-initialized','yes');sessionStorage.setItem('anox:auth:v1',JSON.stringify({idToken:'fixture-token',accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:Date.now()+3600000}));}
  });
  await context.route('https://**/*',async route=>{
   const request=route.request(),url=new URL(request.url()),headers={'access-control-allow-origin':'https://anox.app','access-control-allow-headers':'Authorization,Content-Type,Idempotency-Key','access-control-allow-methods':'GET,POST,OPTIONS','content-type':'application/json'};
   if(url.hostname==='anox.app')return route.fulfill({contentType:url.pathname==='/favicon.svg'?'image/svg+xml':'text/html; charset=utf-8',body:url.pathname==='/favicon.svg'?favicon:html});
   if(url.hostname==='cdn.trychannel3.com')return route.fulfill({contentType:'image/png',body:image});
   if(request.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
   const send=(body,status=200)=>route.fulfill({status,headers,body:JSON.stringify(body)});
   if(url.pathname.startsWith('/catalog/channel3/products/')){
    const id=url.pathname.split('/').pop(),options=Object.fromEntries([...url.searchParams].filter(([k])=>k.startsWith('option_')).map(([k,v])=>[k.slice(7),v]));calls.push({type:'detail',id,options});
    if(id==='slow')await slowGate;
    if(id==='failure'&&failOnce){failOnce=false;return send({error:'catalog_unavailable'},503);}
    return send(detail(id,options)).catch(e=>{if(id!=='slow')throw e;});
   }
   if(url.pathname==='/catalog/search')return send({provider:'channel3',data:{products:[],next_page_token:null},fetchedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString()});
   if(url.pathname.startsWith('/commerce/')){
    const body=request.method()==='POST'?request.postDataJSON():undefined;
    const type=url.pathname==='/commerce/quotes'?'quote':url.pathname==='/commerce/capabilities'?'capabilities':url.pathname==='/commerce/orders'?'orders':'order';
    calls.push({type,body,headers:request.headers()});if(type==='capabilities'&&capabilityAbsentOnce){capabilityAbsentOnce=false;return send({message:'Not Found'},404);}if(type==='quote'&&slowQuote)await quoteGate;
    const event=backendEvent(request.method(),url.pathname,body,{headers:request.headers(),queryStringParameters:Object.fromEntries(url.searchParams)});
    event.requestContext.authorizer.jwt.claims.exp=String(Math.floor(Date.now()/1000)+3600);
    if(!request.headers().authorization)delete event.requestContext.authorizer;
    const result=await handleCommerce(event);return route.fulfill({status:result.statusCode,headers:result.headers,body:result.body});
   }
   if(url.pathname==='/me')return send({user:{displayName:'Fixture customer',email:'fixture@example.test'}});
   if(url.pathname==='/orders')return send({orders:[]});
   unexpected.push(url.origin+url.pathname);return route.abort();
  });
  const page=await context.newPage();await page.clock.install();page.on('pageerror',e=>errors.push(e.message));
  const nav=hash=>page.evaluate(hash=>{location.hash=hash;},hash),ready=()=>page.waitForFunction(()=>{const raw=location.hash.slice(1),at=raw.indexOf('?'),key=at<0?raw+'?':raw;return document.querySelector('#main')?.dataset.commerceDetailKey===key&&!!document.querySelector('[data-commerce-add]');});
  const record=name=>checks.push({engine,mobile,name,pass:true});
  await page.goto('https://anox.app/#product/channel3/shoe_1');await ready();
  if(await page.locator('[data-language="en"]').count())await page.locator('[data-language="en"]').click();
  await ready();assert.equal(calls.filter(c=>c.type==='detail').length,1);assert.equal(calls.filter(c=>c.type==='quote').length,0);
  assert.equal(await page.locator('.commerce-thumbs img').count(),12);assert.equal(await page.locator('.commerce-thumbs img[loading="lazy"]').count(),12);
  assert.match(await page.locator('.commerce-description').textContent(),/Detailed product information/);assert.equal(await page.locator('[data-commerce-add]').isEnabled(),true);
  await page.locator('[data-commerce-swipe]').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('[data-commerce-gallery="1"][aria-pressed="true"]').count(),1);
  if(mobile){await page.locator('[data-commerce-swipe]').dispatchEvent('pointerdown',{clientX:320,clientY:180,pointerId:2,isPrimary:true,pointerType:'touch'});await page.locator('[data-commerce-swipe]').dispatchEvent('pointerup',{clientX:80,clientY:185,pointerId:2,isPrimary:true,pointerType:'touch'});assert.equal(await page.locator('[data-commerce-gallery="2"][aria-pressed="true"]').count(),1);}
  assert.equal(await page.locator('[data-commerce-wishlist]').count(),1,'PDP retains the saved-product action');await page.locator('[data-commerce-wishlist]').click();await nav('wishlist');await page.locator('[data-channel3-saved]').waitFor();await page.reload();await page.locator('[data-channel3-saved]').waitFor();await page.locator('[data-channel3-saved]').click();await ready();
  await page.locator('[data-commerce-option="Size"]').selectOption('L');await ready();assert.deepEqual(calls.filter(c=>c.type==='detail').at(-1).options,{Color:'Navy Blue',Size:'L'});
  await page.locator('[data-commerce-quantity]').fill('2');await page.locator('[data-commerce-quantity]').blur();await page.locator('[data-commerce-add]').click();
  await nav('cart');await page.locator('[data-commerce-cart-quantity]').waitFor();assert.equal(await page.locator('[data-commerce-cart-quantity]').inputValue(),'2');
  await page.locator('[data-commerce-capabilities-retry]').waitFor();assert.equal(await page.locator('[data-commerce-quote]').isDisabled(),true);assert.equal(calls.filter(c=>c.type==='quote').length,0);assert.match(await page.locator('#main').textContent(),/cost verification service is unavailable/);await page.locator('[data-commerce-capabilities-retry]').click();await page.waitForFunction(()=>document.querySelector('[data-commerce-quote]')?.disabled===false);record('absent staged capabilities endpoint keeps quote/payment unavailable and never falls back to legacy checkout');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('anox:selection-cart:v1')));assert.equal(saved.lines[0].options.Size,'L');assert.equal(saved.lines[0].display.stock,null);assert.equal(saved.lines[0].offerUrl,'https://buy.trychannel3.com/tracked?a=1');
  record('direct PDP hydration, full gallery, keyboard/swipe, real option refresh and safe saved metadata');
  await page.reload();await page.locator('[data-commerce-cart-quantity]').waitFor();assert.equal(await page.locator('[data-commerce-cart-quantity]').inputValue(),'2');
  await page.locator('[data-commerce-cart-quantity]').fill('3');await page.locator('[data-commerce-cart-quantity]').blur();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('anox:selection-cart:v1')).lines[0].quantity===3);
  await page.locator('[data-commerce-edit]').click();await ready();assert.equal(await page.locator('[data-commerce-option="Size"]').inputValue(),'L');await page.locator('[data-commerce-option="Size"]').selectOption('M');await ready();await page.locator('[data-commerce-add]').click();await page.locator('[data-commerce-cart-quantity]').waitFor();
  await page.locator('[data-commerce-quote]').click();await page.locator('#commerce-cost-title').waitFor();
  const cost=await page.locator('.commerce-cost').textContent();assert.match(cost,/Estimated TotalUnavailable/);assert.match(cost,/Verified Payable TotalUnavailable/);assert.match(cost,/\$5\.00/);assert.match(cost,/Potential Charges on Arrival/);assert.equal(await page.locator('[data-commerce-checkout]').isDisabled(),true);
  assert.equal(await page.locator('[data-commerce-quote-line]').count(),1);assert.match(await page.locator('[data-commerce-quote-line]').textContent(),/Fresh unit price.*\$104\.95/);assert.match(await page.locator('[data-commerce-price-change]').textContent(),/Saved unit price.*\$99\.95.*Fresh unit price.*\$104\.95/);assert.match(await page.locator('[data-commerce-quote-line]').textContent(),/Line subtotal.*\$314\.85/);
  const request=calls.filter(c=>c.type==='quote').at(-1);assert.equal(request.body.lines[0].quantity,3);assert.equal(request.body.lines[0].options.Size,'M');assert.equal(request.body.lines[0].priceCents,undefined);assert.match(request.headers['idempotency-key'],/^[A-Za-z0-9_-]{16,128}$/);
  record('cart restores, edits, requests authenticated server quote and leaves unknown costs and payment unavailable');
  const second=await context.newPage();await second.goto('https://anox.app/#cart');await second.locator('[data-commerce-cart-quantity]').waitFor();assert.equal(await second.locator('[data-commerce-cart-quantity]').inputValue(),'3');
  await page.locator('[data-commerce-cart-quantity]').fill('2');await page.locator('[data-commerce-cart-quantity]').blur();await page.waitForFunction(()=>!document.querySelector('#commerce-cost-title'));await second.waitForFunction(()=>document.querySelector('[data-commerce-cart-quantity]')?.value==='2');await second.close();
  slowQuote=true;quoteGate=new Promise(r=>releaseQuote=r);await page.locator('[data-commerce-quote]').click();await page.waitForFunction(()=>document.querySelector('[data-commerce-quote]')?.disabled);
  await page.evaluate(()=>window.AnoXAuth.signOut(false));releaseQuote();await page.waitForTimeout(80);assert.equal(await page.locator('#commerce-cost-title').count(),0);assert.equal(await page.locator('[data-commerce-quote]').count(),0);slowQuote=false;
  record('cart edits and sign-out discard pending quotes and protected data');
  await nav('product/channel3/relaxed?option_Size=L');await ready();assert.equal(await page.locator('[data-commerce-add]').isDisabled(),true);await page.locator('[data-commerce-accept-options]').click();await ready();assert.equal(await page.locator('[data-commerce-option="Size"]').inputValue(),'M');assert.equal(await page.locator('[data-commerce-add]').isEnabled(),true);
  await nav('product/channel3/other-merchant?merchant=example.com&condition=new');await ready();assert.equal(await page.locator('[data-commerce-add]').isDisabled(),true);assert.match(await page.locator('#commerce-merchant').textContent(),/Requested offer unavailable/);await page.locator('#commerce-merchant').selectOption('0');assert.equal(await page.locator('[data-commerce-add]').isEnabled(),true);
  record('relaxed options and missing requested merchant require deliberate acceptance');
  await nav('product/channel3/two-merchants');await ready();const merchantCalls=calls.filter(c=>c.type==='detail').length;await page.locator('#commerce-merchant').selectOption('1');assert.equal(calls.filter(c=>c.type==='detail').length,merchantCalls,'selecting a fresh offer must not spend another detail call');assert.match(await page.locator('#commerce-merchant option:checked').textContent(),/second.example/);await page.reload();await ready();assert.match(await page.locator('#commerce-merchant option:checked').textContent(),/second.example/,'merchant selection survives refresh');
  await nav('product/channel3/variant-source');await ready();await page.locator('[data-commerce-add]').click();await nav('cart');await page.locator('[data-commerce-edit="1"]').waitFor();await page.locator('[data-commerce-edit="1"]').click();await ready();await page.locator('[data-commerce-option="Color"]').selectOption('Red');await ready();assert.match(page.url(),/product\/channel3\/variant-target/,'provider product_id controls the selected variant identity');assert.equal(calls.filter(c=>c.type==='detail').at(-1).id,'variant-target');assert.equal(await page.locator('[data-commerce-option="Color"]').inputValue(),'Red','clicked variant label survives product identity navigation');assert.equal(await page.locator('[data-commerce-option="Size"]').inputValue(),'M');await page.locator('[data-commerce-add]').click();await page.locator('[data-commerce-edit="1"]').waitFor();assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('anox:selection-cart:v1')).lines.map(line=>line.productId)),['shoe_1','variant-target']);
  await nav('product/channel3/ambiguous');await ready();assert.equal(await page.locator('[data-commerce-add]').isDisabled(),true,'indistinguishable merchant offers must not silently select the first');
  await nav('product/channel3/unknown-variant');await ready();assert.doesNotMatch(await page.locator('#main').textContent(),/Source reports available/,'unknown selected variant cannot inherit merchant-level availability');assert.match(await page.locator('#main').textContent(),/Availability unconfirmed/);
  record('merchant reload, distinct variant identity, ambiguous offers and unknown selected availability remain explicit');
  await page.route('https://cdn.trychannel3.com/fail0.jpg',route=>route.abort(),{times:1});await nav('product/channel3/image-failure');await ready();await page.locator('.commerce-gallery-stage .commerce-image-empty').waitFor();await page.locator('.commerce-thumbs [data-commerce-gallery="0"]').click();await page.waitForFunction(()=>document.querySelector('.commerce-main-image')?.naturalWidth>0);record('failed gallery image recovers on explicit thumbnail retry without another product request');
  await nav('product/channel3/incomplete');await ready();assert.equal(await page.locator('.commerce-main-image').count(),0);assert.equal(await page.locator('[data-commerce-add]').isDisabled(),true);
  await nav('product/channel3/failure');await page.locator('[data-commerce-detail-retry]').waitFor();await page.locator('[data-commerce-detail-retry]').click();await ready();
  const slow=page.waitForRequest(r=>r.url().includes('/products/slow'));await nav('product/channel3/slow');await slow;await nav('product/channel3/fast');await ready();releaseSlow();await page.waitForTimeout(80);assert.match(await page.locator('#main h1').textContent(),/fast/);
  record('incomplete data, deliberate error retry and late navigation response remain safe');
  await page.clock.fastForward(31000);await page.locator('[data-commerce-detail-retry]').waitFor();assert.equal(await page.locator('[data-commerce-add]').isDisabled(),true);assert.equal(await page.locator('#commerce-merchant').count(),0);assert.equal(await page.locator('[data-retailer-link="channel3-live"]').count(),0);assert.doesNotMatch(await page.locator('#main').textContent(),/\$99\.95|Source reports available/);await page.clock.resume();
  record('expiry clears price, availability and rotating offer URL without an upstream polling loop');
  await nav('order?id=owned-order&paid=true');await page.waitForFunction(()=>document.querySelector('#main')?.textContent.includes('Sign in to read'));
  assert.doesNotMatch(await page.locator('#main').textContent(),/succeeded/);
  await page.evaluate(()=>{sessionStorage.setItem('anox:auth:v1',JSON.stringify({idToken:'fixture-token',accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:Date.now()+3600000}));});await page.reload();await page.waitForFunction(()=>document.querySelector('#main')?.textContent.includes('Server')||document.querySelector('#main')?.textContent.includes('Order status'));await page.locator('#main h2').filter({hasText:'owned-order'}).waitFor();assert.match(await page.locator('#main').textContent(),/Payment statuspending/);assert.doesNotMatch(await page.locator('#main').textContent(),/succeeded/);
  await nav('order?id=not-owned');await page.waitForFunction(()=>document.querySelector('#main')?.textContent.includes('No order with this reference'));record('owned order route uses server payment state and rejects foreign or unsigned access');
  await nav('privacy');await page.locator('[data-clear-local]').click();await page.locator('[data-confirm-clear]').click();await page.waitForFunction(()=>location.hash==='#home'&&localStorage.getItem('anox:selection-cart:v1')===null);await nav('cart');await page.waitForFunction(()=>document.querySelector('#main')?.textContent.includes('Your cart is empty'));assert.equal(await page.locator('[data-commerce-cart-quantity]').count(),0);record('explicit browser-data clearing erases the production cart through its serialized API');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(await page.evaluate(()=>window.__commerceCsp),[]);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);record('responsive layout, runtime and strict production CSP pass');
  await context.close();console.log(engine+(mobile?' mobile':' desktop')+': '+checks.filter(c=>c.engine===engine&&c.mobile===mobile).length+' groups passed');
 }finally{await browser.close();}
}
(async()=>{for(const engine of (process.env.ENGINES||'chromium').split(',')){await run(engine,false);await run(engine,true);}console.log(JSON.stringify({checks},null,2));})().catch(error=>{console.error(error);process.exitCode=1;});
