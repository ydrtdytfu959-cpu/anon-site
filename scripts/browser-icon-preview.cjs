#!/usr/bin/env node
'use strict';
// Review artifact only: serve checked-in files through Playwright interception.
// No HTTP server, provider, customer data or external requests are needed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const engines=require(process.env.PLAYWRIGHT_MODULE||'playwright'),root=path.resolve(__dirname,'..');
const origin='https://icon-review.example.test';
async function run(name){
  const browser=await engines[name].launch();
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[],bad=[],unexpected=[];
    await page.addInitScript(()=>{window.__csp=[];addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective));});
    page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)bad.push(r.url());});
    await page.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin!==origin||request.method()!=='GET'){unexpected.push(request.url());return route.abort();}
      if(url.pathname==='/favicon.ico')return route.fulfill({status:204,body:''});
      const file=path.resolve(root,'.'+decodeURIComponent(url.pathname)),extension=path.extname(file);
      const type={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png'}[extension];
      if(!file.startsWith(root+path.sep)||!type||!fs.existsSync(file)){unexpected.push(url.pathname);return route.abort();}
      return route.fulfill({contentType:type,body:fs.readFileSync(file)});
    });
    await page.goto(origin+'/docs/design/preview.html');await page.locator('#atlas svg').last().waitFor();
    assert.equal(await page.locator('#atlas svg').count(),35);
    let comparisons=0;
    for(const viewport of ['desktop','mobile','tablet','narrow']){
      await page.selectOption('#viewport',viewport);
      for(const screen of await page.locator('#screen option').evaluateAll(nodes=>nodes.map(n=>n.value))){
        await page.selectOption('#screen',screen);
        await page.waitForFunction(()=>['before','after'].every(id=>document.getElementById(id).complete&&document.getElementById(id).naturalWidth>0));comparisons++;
      }
    }
    for(const [value,reveal] of [['100','0%'],['0','100%']]){
      await page.locator('#reveal').fill(value);assert.equal(await page.locator('#comparison').evaluate(n=>n.style.getPropertyValue('--reveal')),reveal);
    }
    await page.locator('#sample-heart').click();assert.equal(await page.locator('#sample-heart').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#sample-disabled').isDisabled(),true);
    await page.locator('#theme').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
    for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'preview fits '+width);}
    assert.deepEqual(errors,[]);assert.deepEqual(bad,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(await page.evaluate(()=>window.__csp),[]);
    console.log(`${name}: ${comparisons} review comparisons, slider endpoints, 35 glyphs, saved/disabled/theme states and four viewport layouts passed`);
  }finally{await browser.close();}
}
(async()=>{for(const name of (process.env.ENGINES||'chromium').split(','))await run(name);})().catch(e=>{console.error(e);process.exitCode=1;});
