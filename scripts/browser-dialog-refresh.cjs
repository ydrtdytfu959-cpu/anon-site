#!/usr/bin/env node
'use strict';
// Delayed, intercepted catalog responses reproduce a real dialog-dismissal race.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const engines=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=require('../tests/fixtures/cinematic/catalog.cjs');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const checks=[];
async function run(browser,engine,kind,mobile,lang){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:960},isMobile:engine!=='firefox'&&mobile,hasTouch:mobile,reducedMotion:'reduce',serviceWorkers:'block'});
 let release,requested;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{requested=resolve;});
 const unexpected=[],errors=[];
 try{
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   const headers={'access-control-allow-origin':'https://anox.app','content-type':'application/json'};
   if(req.method()==='GET'&&url.hostname==='anox.app'&&url.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
   if(req.method()==='GET'&&(url.hostname==='cdn.trychannel3.com'||url.hostname==='anox.app'&&url.pathname==='/favicon.svg'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>'});
   if(req.method()==='GET'&&url.pathname==='/catalog/search'){
    requested();await gate;
    return route.fulfill({headers,body:JSON.stringify({provider:'channel3',data:{products:[fixture.searchProduct(url.searchParams.get('q'),0)],next_page_token:null},fetchedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString()})});
   }
   if(req.method()==='GET'&&url.pathname==='/catalog/products')return route.fulfill({headers,body:'{"products":[],"total":0,"nextOffset":null}'});
   unexpected.push(req.method()+' '+url.origin+url.pathname);return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://anox.app/#home');await started;
  if(lang==='ar')await page.locator('[data-language="ar"]').click();
  const opener=page.locator('[data-open="'+kind+'"]').filter({visible:true}).first();
  if(mobile)await opener.tap();else{await opener.focus();await page.keyboard.press('Enter');}
  const dialog=page.locator('#dialog');await dialog.waitFor({state:'visible'});
  // Let the dialog's initial animation-frame focus land before typing, just as
  // a shopper would. The catalog remains blocked throughout this step.
  await page.waitForFunction(id=>document.activeElement?.id===id,kind==='search'?'search-query':mobile?'dialog-title':'anox-message');
  const field=page.locator(kind==='search'?'#search-query':'#anox-message');
  const draft=lang==='ar'?'حذاء Nike':'Nike shoes';await field.fill(draft);
  await page.evaluate(()=>{window.__dialogField=document.activeElement;window.__dialogNode=document.querySelector('#dialog-content').firstElementChild;});
  release();
  await page.waitForFunction(()=>document.querySelectorAll('.anox-home-grid .v2-product-card').length>0&&!/Loading products|جارٍ تحميل المنتجات/.test(document.querySelector('#main').textContent));
  assert.equal(await dialog.isVisible(),true,kind+' remains open after delayed catalog refresh');
  assert.equal(await field.inputValue(),draft,kind+' preserves the typed draft');
  const retained=await page.evaluate(()=>({focus:document.activeElement===window.__dialogField,dom:document.querySelector('#dialog-content').firstElementChild===window.__dialogNode,active:document.activeElement?.id,previous:window.__dialogField?.id}));
  assert.ok(retained.focus&&retained.dom,JSON.stringify({engine,kind,mobile,lang,...retained})+' dialog DOM and focus survive refresh');
  assert.equal(await page.locator('#main').evaluate(n=>n.inert),true,'background stays inert');
  assert.equal(await opener.getAttribute('aria-expanded'),'true','current opener exposes expanded state');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.querySelector('#dialog').contains(document.activeElement)),true,'Tab remains trapped');
  await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.querySelector('#dialog').contains(document.activeElement)),true,'reverse Tab remains trapped');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.equal(await opener.evaluate(n=>n===document.activeElement),true,'Escape restores the current opener after shell replacement');
  assert.equal(await opener.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#main').evaluate(n=>n.inert),false);
  // Actual navigation must still dismiss the overlay; no stale modal over a new route.
  await opener.click();await dialog.waitFor({state:'visible'});
  await page.evaluate(()=>{location.hash='request';});await dialog.waitFor({state:'hidden'});
  assert.equal(await page.locator('#main').evaluate(n=>n.inert),false);
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[],'no live calls or mutations');
  checks.push({engine,kind,viewport:mobile?'mobile':'desktop',lang});
 }finally{release();await context.close();}
}
(async()=>{for(const engine of(process.env.ENGINES||'chromium,firefox,webkit').split(',')){
 const browser=await engines[engine].launch();try{for(const kind of['search','assistant'])for(const mobile of[true,false])for(const lang of['en','ar'])await run(browser,engine,kind,mobile,lang);}finally{await browser.close();}
}console.log(JSON.stringify({passed:checks.length,checks},null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
