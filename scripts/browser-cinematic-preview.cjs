#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {createServer}=require('./serve-cinematic.cjs');
const engines=require('playwright');
(async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 try{for(const engine of (process.env.ENGINES||'chromium').split(',')){
  const browser=await engines[engine].launch();
  try{
   const unprotected=await browser.newContext({serviceWorkers:'block'}),attempted=[];
   await unprotected.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();attempted.push(route.request().url());return route.abort();});
   const direct=await unprotected.newPage();await direct.goto(origin+'/preview/index.html#product/channel3/cinematic-jacket');
   await direct.waitForURL(origin+'/preview/start.html');
   assert.equal(await direct.locator('[data-commerce-add]').count(),0);
   assert.deepEqual(attempted,[],'direct entry without a worker cannot attempt production requests');
   await unprotected.close();
   const context=await browser.newContext(),escaped=[],errors=[],responses=[];
   await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();escaped.push(route.request().url());return route.abort();});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>responses.push({url:r.url(),status:r.status(),worker:r.fromServiceWorker()}));
   await page.goto(origin+'/preview/');await page.getByRole('link',{name:'Open interactive preview →'}).click();
   try{await page.locator('[data-commerce-add]').waitFor({timeout:10000});}catch(error){console.error(JSON.stringify({engine,errors,escaped,responses,text:await page.locator('#main').textContent()},null,2));throw error;}
   await page.waitForFunction(()=>document.querySelector('.commerce-main-image')?.naturalWidth>0);
   await page.locator('[data-commerce-option="Size"]').selectOption('L');await page.waitForFunction(()=>document.querySelector('[data-commerce-option="Size"]')?.value==='L'&&document.querySelector('[data-commerce-add]')?.disabled===false);
   await page.locator('[data-commerce-add]').click();await page.getByRole('link',{name:'Cart',exact:true}).first().click();await page.locator('[data-commerce-cart-quantity]').waitFor();assert.equal(await page.locator('[data-commerce-checkout]').isDisabled(),true);
   assert.deepEqual(escaped,[]);assert.ok(responses.some(r=>r.url.includes('/catalog/channel3/products/')&&r.worker&&r.status===200));assert.deepEqual(errors,[]);
   console.log(engine+': isolated preview, image, variant, persisted selection and disabled payment passed; zero escaped requests');
   await page.goto(origin+'/docs/cinematic/preview.html');
   for(const width of [320,1440]){
    await page.setViewportSize({width,height:900});
    for(const view of ['mobile','desktop']){
     await page.locator('button[data-viewport="'+view+'"]').click();
     for(const scene of await page.locator('#scene option').evaluateAll(nodes=>nodes.map(n=>n.value))){
      await page.locator('#scene').selectOption(scene);
      await page.waitForFunction(()=>['before','after'].every(side=>{const img=document.getElementById(side+'-image');return img.complete&&img.naturalWidth>0&&!img.hidden;}));
     }
    }
    await page.locator('button[data-mode="after"]').click();assert.equal(await page.locator('#comparison-images').getAttribute('data-mode'),'after');
    await page.locator('#actual-size').click();assert.equal(await page.locator('#actual-size').getAttribute('aria-pressed'),'true');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'review fits viewport with actual-size image scrollers');
    await page.locator('#actual-size').click();await page.locator('button[data-mode="both"]').click();
   }
   assert.deepEqual(escaped,[]);assert.deepEqual(errors,[]);
   console.log(engine+': review comparisons load all 21 states, both image sizes and display controls at 320/1440px');
  }finally{await browser.close();}
 }}finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
