#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const engines=require(process.env.PLAYWRIGHT_MODULE||'playwright');
if(!process.argv.includes('--live'))throw Error('Use --live to run the bounded deployed catalog check');
(async()=>{
  const browser=await engines.chromium.launch();
  try{
    const context=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'}),errors=[],calls=[];
    await context.addInitScript(()=>{window.__catalogCsp=[];window.addEventListener('securitypolicyviolation',e=>window.__catalogCsp.push(e.violatedDirective));});
    await context.route('https://**/*',route=>{
      const u=new URL(route.request().url());
      if(u.hostname==='anox.app')return route.fulfill({contentType:'text/html; charset=utf-8',body:fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')});
      if(u.origin==='https://zmumi2wruk.execute-api.us-east-2.amazonaws.com'&&u.pathname==='/catalog/search'){
        calls.push({section:u.searchParams.get('section'),cursorProvided:u.searchParams.has('page_token')});return route.continue();
      }
      if(['cdn.trychannel3.com','static.nike.com'].includes(u.hostname))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64')});
      return route.abort();
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto('https://anox.app/#shop?section=featured');
    await page.locator('#main .v2-catalog-grid .v2-product-card').first().waitFor({timeout:25000});
    const selector='#main .v2-catalog-grid .v2-product-card',first=await page.locator(selector).count();
    let loadedMore=false;
    if(await page.locator('[data-live-load-more]').count()){
      await page.locator('[data-live-load-more]').click();
      await page.waitForFunction(({selector,first})=>document.querySelectorAll(selector).length>first,{selector,first},{timeout:25000});loadedMore=true;
    }
    const links=await page.locator(selector).evaluateAll(nodes=>nodes.map(node=>node.querySelector('a[href*="product/"]')?.getAttribute('href')));
    assert.equal(new Set(links).size,links.length);
    assert.deepEqual(await page.evaluate(()=>window.__catalogCsp),[]);assert.deepEqual(errors,[]);
    assert.equal(calls[0].cursorProvided,false);if(loadedMore)assert.equal(calls[1].cursorProvided,true);
    fs.mkdirSync(path.join(__dirname,'..','test-results'),{recursive:true});
    await page.screenshot({path:path.join(__dirname,'..','test-results','live-catalog.png'),fullPage:true});
    console.log(JSON.stringify({browser:browser.version(),firstPage:first,rendered:links.length,loadedMore,calls,cspViolations:0,runtimeErrors:0}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
