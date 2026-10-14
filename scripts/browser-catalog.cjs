#!/usr/bin/env node
'use strict';
// Uses the real production bundle and CSP, with a deterministic upstream fixture.
// No live customer/auth/commerce endpoints are contacted.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const engines = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const checks = [];
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
const sources=Object.freeze({
 Nike:['Nike','nike.com','nike'],adidas:['adidas','adidas.com','adidas'],
 "Levi's":["Levi's",'levi.com','levis'],"e.l.f. cosmetics":['e.l.f. Cosmetics','elfcosmetics.com','elf'],
 Sephora:['Sephora Collection','sephora.com','sephora'],"TJ Maxx":['Other','tjmaxx.tjx.com','tjmaxx'],
 "Levi's men":["Levi's",'levi.com','levismen'],"Nike women":['Nike','nike.com','nikewomen'],
 'Nike accessories':['Nike','nike.com','nikeaccessories'],'Nike sports':['Nike','nike.com','nikesports']
});
const featuredQueries=['Nike','adidas',"Levi's",'e.l.f. cosmetics','Sephora','TJ Maxx'];
const product = (context, n, query) => {
  const [brand,domain,tag]=sources[query]||['Nike','nike.com','generic'];
  return {id:`${context}-${tag}-${n}`,title:`Fixture ${context} shoes ${n}`,brands:[{id:'fixture',name:brand}],
   category:{slug:'shoes',title:'Shoes'},images:[{url:'https://cdn.trychannel3.com/fixture.png'}],
   offers:[{url:'https://buy.trychannel3.com/fixture',domain,availability:'InStock',condition:'new',price:{price:45,currency:'USD'}}]};
};

async function run(engine) {
  const browser = await engines[engine].launch();
  try {
    const context = await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'});
    const calls = [], errors = [], unexpected = [];
    let releaseSlow;
    const slowResponse = new Promise(resolve => {releaseSlow=resolve;});
    await context.addInitScript(() => {
      window.__catalogCsp = [];
      window.addEventListener('securitypolicyviolation', e => window.__catalogCsp.push(e.violatedDirective));
    });
    await context.route('https://**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.hostname === 'anox.app') {
        return route.fulfill({contentType:url.pathname.includes('favicon')?'image/svg+xml':'text/html; charset=utf-8',body:url.pathname.includes('favicon')?'<svg xmlns="http://www.w3.org/2000/svg"/>':html});
      }
      if (['cdn.trychannel3.com','static.nike.com'].includes(url.hostname)) return route.fulfill({contentType:'image/png',body:image});
      const headers = {'access-control-allow-origin':'https://anox.app','content-type':'application/json'};
      if (url.pathname === '/catalog/search') {
        const q = url.searchParams.get('q'), section = url.searchParams.get('section'), cursor = url.searchParams.get('page_token');
        const sectionOfQuery={"Levi's men":'men',"Nike women":'women',"Nike accessories":'accessories',"Nike sports":'sports'};
        const key = featuredQueries.includes(q) ? 'featured' : sectionOfQuery[q] || q || section;
        calls.push({q,section,cursor});
        if (key === 'slow') await slowResponse;
        if (key === 'failure') return route.fulfill({status:503,headers,body:JSON.stringify({error:'catalog_unavailable'})});
        if (key === 'expired' && cursor) return route.fulfill({status:410,headers,body:JSON.stringify({error:'catalog_cursor_expired'})});
        const cursorKey=q||section;
        const page = cursor === null ? 1 : cursor === `fixture-${cursorKey}-2` ? 2 : cursor === `fixture-${cursorKey}-3` ? 3 : 0;
        assert.ok(page, 'cursor stayed in its original query context');
        const mixed=featuredQueries.includes(q);
        // Each source yields 12 verified records on a single paid search page.
        // The six sources therefore buffer 72 cards across three user-facing pages.
        const start = mixed ? 0 : page===1?0:page===2?23:46,
          size = mixed?12:(page===3?4:24), now = Date.now();
        const body = {provider:'channel3',data:{products:Array.from({length:size}, (_, n)=>product(key,start+n,q)),next_page_token:mixed?null:(page<3?`fixture-${cursorKey}-${page+1}`:null)},
          fetchedAt:new Date(now).toISOString(),expiresAt:new Date(now+(q?300000:600000)).toISOString()};
        return route.fulfill({headers,body:JSON.stringify(body)}).catch(error=>{if(key!=='slow')throw error;});
      }
      // Baseline developer tests load their isolated in-memory preview; no external providers.
      if (url.pathname === '/catalog/products') return route.fulfill({headers,body:'{"products":[],"total":0,"nextOffset":null}'});
      unexpected.push(url.origin+url.pathname);
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    const nav = route => page.evaluate(route=>{location.hash=route;},route);
    const cards = () => page.locator('#main .v2-catalog-grid .v2-product-card');
    const count = async n => page.waitForFunction(n=>document.querySelectorAll('#main .v2-catalog-grid .v2-product-card').length===n,n);
    const inContext = async (key,n=24) => page.waitForFunction(({key,n})=>{
      const nodes=[...document.querySelectorAll('#main .v2-catalog-grid .v2-product-card')];
      return nodes.length===n&&nodes.every(node=>node.textContent.includes(`Fixture ${key} shoes`));
    },{key,n});
    const add = name => checks.push({engine,name,pass:true});

    await page.goto('https://anox.app/#shop');
    await count(24);
    assert.deepEqual(calls.map(c=>c.q),featuredQueries);
    assert.ok(calls.every(c=>c.section===null&&c.cursor===null));
    assert.ok((await cards().allTextContents()).every(text=>text.includes('Check current price on product page')&&!text.includes('$45.00')));
    assert.equal(await cards().locator('[data-retailer-link]').count(),0);
    assert.equal(await page.locator('[data-filter="maxPrice"],[data-filter="available"],[data-v2-filter="size"],[data-v2-filter="color"]').count(),0);
    assert.equal(await page.locator('[data-sort] option[value="low"],[data-sort] option[value="high"]').count(),0);
    add('cached cards show presentation only without price, stock, retailer links or unsupported controls');
    await nav('shop?maxPrice=50&sort=low');await page.locator('[data-catalog-filter-unavailable]').waitFor();
    assert.equal(await cards().count(),0);assert.equal(calls.length,6);
    await page.locator('[data-clear-filters]').last().click();await count(24);assert.equal(calls.length,6);
    add('legacy price-filter URLs disclose unavailable data and recover without extra upstream requests');
    add('empty storefront requests one lazy discovery section');
    await page.locator('[data-live-load-more]').click();await count(48);
    await page.locator('[data-live-load-more]').click();await count(72);
    assert.equal(await page.locator('[data-live-load-more]').count(),0);
    assert.equal(calls.length,18);
    assert.deepEqual(calls.slice(0,6).map(c=>c.q),featuredQueries);
    // Cached provider pages remain the same; the mixed cursor only advances
    // in-memory offsets, never inventing a continuation token.
    assert.deepEqual(calls.slice(6,12).map(c=>c.cursor),featuredQueries.map(()=>null));
    assert.deepEqual(calls.slice(12,18).map(c=>c.cursor),featuredQueries.map(()=>null));
    const identities=await cards().evaluateAll(nodes=>nodes.map(n=>n.querySelector('a[href*="product/"]')?.getAttribute('href')));
    assert.equal(new Set(identities).size,72);
    assert.ok((await cards().evaluateAll(nodes=>nodes.map(n=>n.querySelectorAll('img').length))).every(n=>n===1));
    add('three pages render with stable deduplication and one image per card');

    await page.locator('[data-discovery-section="men"]').first().click();await inContext('men');
    assert.deepEqual(calls.at(-1),{q:"Levi's men",section:null,cursor:null});
    await page.locator('[data-discovery-section="women"]').first().click();await inContext('women');
    assert.deepEqual(calls.at(-1),{q:'Nike women',section:null,cursor:null});
    const before=calls.length;
    await nav('shop?section=featured');await count(72);assert.equal(calls.length,before);
    add('sections have independent results and retain their own pagination');

    await nav('search?q=sneakers');await inContext('sneakers');
    await page.locator('[data-live-load-more]').click();await count(47);
    await nav('search?q=beauty');await inContext('beauty');
    assert.deepEqual(calls.at(-1),{q:'beauty',section:null,cursor:null});
    const slowStarted=page.waitForRequest(request=>new URL(request.url()).searchParams.get('q')==='slow');
    await nav('search?q=slow');await slowStarted;
    await nav('search?q=fast');await inContext('fast');releaseSlow();await page.waitForTimeout(100);
    assert.ok((await cards().allTextContents()).every(s=>s.includes('fast')));
    add('search resets cursor; stale responses cannot replace new results');

    await nav('search?q=expired');await inContext('expired');
    await page.locator('[data-live-load-more]').click();await page.locator('[data-live-restart]').waitFor();
    assert.equal(await cards().count(),24);
    const expiredCalls=calls.length;
    await page.waitForTimeout(100);assert.equal(calls.length,expiredCalls);
    const restart=page.waitForRequest(request=>{const u=new URL(request.url());return u.searchParams.get('q')==='expired'&&!u.searchParams.has('page_token');});
    await page.locator('[data-live-restart]').click();await restart;await inContext('expired');
    assert.equal(calls.at(-1).cursor,null);
    add('expired cursor keeps products and requires explicit restart');

    await nav('search?q=failure');await page.locator('[data-live-retry]').waitFor();
    const failureCalls=calls.length;await page.waitForTimeout(100);assert.equal(calls.length,failureCalls);
    add('upstream error offers deliberate retry without request loops');
    assert.deepEqual(await page.evaluate(()=>window.__catalogCsp),[]);
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
    add('browser runtime and production CSP remain valid');

    await page.goto('https://anox.app/?debug=1#debug');
    await page.waitForFunction(()=>/\d+\/\d+ PASS/.test(document.querySelector('#main')?.textContent||''),null,{timeout:60000});
    const rows=await page.locator('#main tbody tr').evaluateAll(nodes=>nodes.map(n=>({status:n.cells[0].textContent,name:n.cells[1].textContent})));
    // The legacy favicon assertion now covers the actual intentional same-origin
    // asset. No failures are exempted in this broader commerce validation.
    assert.deepEqual(rows.filter(r=>r.status!=='PASS'),[]);
    assert.ok(rows.length>100);assert.deepEqual(errors,[]);
    add(`existing self-tests: ${rows.length}/${rows.length}`);
    await context.close();
    console.log(`${engine}: ${checks.filter(c=>c.engine===engine).length} browser groups passed`);
  } finally { await browser.close(); }
}
(async()=>{for(const engine of (process.env.ENGINES||'chromium').split(','))await run(engine);console.log(JSON.stringify({checks},null,2));})().catch(error=>{console.error(error);process.exitCode=1;});
