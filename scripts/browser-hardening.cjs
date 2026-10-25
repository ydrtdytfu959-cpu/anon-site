#!/usr/bin/env node
'use strict';
// Real shipped HTML/CSP; all remote traffic is intercepted. No live accounts or providers.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const browsers=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {product,envelope}=require('../tests/fixtures/channel3-detail.cjs');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const checks=[];
async function run(engine,scenario){
 const browser=await browsers[engine].launch();
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const unexpected=[],errors=[],calls=[];let release,slow=true;
  const gate=new Promise(resolve=>{release=resolve;});
  const title='<img src=x onerror="window.fixtureExecuted=1"> & "Original"';
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url()),headers={'access-control-allow-origin':'https://anox.app','content-type':'application/json'};
   if(url.hostname==='anox.app')return route.fulfill({contentType:url.pathname==='/favicon.svg'?'image/svg+xml':'text/html',body:url.pathname==='/favicon.svg'?'<svg xmlns="http://www.w3.org/2000/svg"/>':html});
   if(url.hostname==='cdn.trychannel3.com')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#777"/></svg>'});
   if(url.pathname==='/catalog/channel3/products/shoe_1'){
    calls.push(url.search);if(slow){slow=false;await gate;}
    return route.fulfill({headers,body:JSON.stringify(envelope({},product({title,description:title,materials:[title],key_features:[title],structured_attributes:{Details:[title]}})))}).catch(()=>{});
   }
   if(url.pathname==='/catalog/search')return route.fulfill({headers,body:JSON.stringify({provider:'channel3',data:{products:[],next_page_token:null},fetchedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString()})});
   if(url.pathname==='/catalog/products')return route.fulfill({headers,body:'{"products":[],"total":0,"nextOffset":null}'});
   unexpected.push(url.origin+url.pathname);return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://anox.app/#product/channel3/shoe_1');
  await page.waitForFunction(()=>document.querySelector('#main')?.textContent.includes('Checking current product'));
  await page.evaluate(suffix=>{location.hash='product/channel3/shoe_1?'+suffix;},scenario.suffix);
  await page.waitForFunction(message=>document.querySelector('#main')?.textContent.includes(message),scenario.message);
  await page.evaluate(()=>history.back());
  await page.waitForFunction(()=>location.hash==='#product/channel3/shoe_1');
  release();
  await page.locator('[data-commerce-add]').waitFor({timeout:5000});
  assert.equal(calls.length,2,'returning from rejected navigation restarts the aborted detail request exactly once');
  checks.push({engine,name:scenario.name+' navigation recovers an aborted detail request'});
  assert.equal(await page.locator('#main h1').textContent(),title);
  assert.equal(await page.locator('#main [onerror],#main script').count(),0);
  assert.equal(await page.evaluate(()=>window.fixtureExecuted),undefined);
  assert.ok((await page.locator('#main').textContent()).includes(title));
  checks.push({engine,name:'untrusted product text remains literal in detail and disclosures'});
  const choice=page.locator('[data-commerce-option="Color"]');
  assert.equal(await choice.inputValue(),'Navy Blue');
  // An empty selection must never leave a blank control over a still-saveable old choice.
  await choice.evaluate(n=>{n.value='';n.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await choice.inputValue(),'Navy Blue','empty choice restores the verified visible selection');
  assert.equal(await page.locator('[data-commerce-add]').isEnabled(),true);
  checks.push({engine,name:'displayed variant and saveable selection stay consistent'});
  if(process.env.HARDENING_SCREENSHOTS&&engine==='chromium'&&scenario.name==='invalid-option'){
   const dir=path.resolve(process.env.HARDENING_SCREENSHOTS);fs.mkdirSync(dir,{recursive:true});
   await page.screenshot({path:path.join(dir,'product-recovery-mobile.png'),fullPage:true});
   await page.setViewportSize({width:1440,height:1000});
   await page.screenshot({path:path.join(dir,'product-recovery-desktop.png'),fullPage:true});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  await context.close();
 }finally{await browser.close();}
}
(async()=>{for(const engine of (process.env.ENGINES||'chromium').split(','))for(const scenario of [
 {name:'invalid-option',suffix:'option_constructor=invalid',message:'Invalid product options'},
 {name:'stale-cart-edit',suffix:'edit=stale-revision&line=0',message:'Cart changed'}
])await run(engine,scenario);console.log(JSON.stringify({checks},null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
