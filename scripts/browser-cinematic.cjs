#!/usr/bin/env node
'use strict';
// Screenshots of the real application, using strictly offline synthetic fixtures.
// No live services, customer records, purchases, quotes, or provider credits.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),zlib=require('node:zlib');
const engines=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),source=path.resolve(process.env.HTML_PATH||path.join(root,'index.html'));
const html=fs.readFileSync(source,'utf8'),out=process.env.SCREENSHOT_DIR&&path.resolve(process.env.SCREENSHOT_DIR);
const fixture=require('../tests/fixtures/cinematic/catalog.cjs');
const {createHandler}=require('../backend/commerce/index.js');
const {MemoryStore,event:backendEvent,config}=require('../tests/helpers/commerce.cjs');
const views={narrow:{width:320,height:780},small:{width:375,height:812},mobile:{width:390,height:844},large:{width:430,height:932},tablet:{width:768,height:1024},desktop:{width:1440,height:960},wide:{width:1920,height:1080},landscape:{width:844,height:390}};
const aliases={'320':'narrow','375':'small','390':'mobile','430':'large','768':'tablet','1440':'desktop','1920':'wide'};
const allScenes=['pdp','pdp-light','pdp-rtl','pdp-long','pdp-missing','pdp-footwear','pdp-beauty','home','shop','cart','account','signin','request','orders','search','assistant','wishlist','home-light','home-rtl','retailers','pdp-stale'];
const scenes=(process.env.SCENES||allScenes.join(',')).split(',');
for(const scene of scenes)assert.ok(allScenes.includes(scene),'known cinematic scene '+scene);
const imagePath=path.join(root,'tests/fixtures/cinematic',process.env.CINEMATIC_ART==='svg'?'jacket.svg':'jacket-preview.png');
assert.ok(fs.existsSync(imagePath),'Original fixture artwork must exist: '+imagePath);
const art=fs.readFileSync(imagePath),favicon=fs.readFileSync(path.join(root,'favicon.svg'),'utf8');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const report={source:path.relative(root,source),sha256:sha(html),baseline:process.env.BASELINE==='1',fixture:'Offline synthetic account, product, merchant offer and artwork. Actual rendered AnoX HTML/CSP; no real merchant inventory or production API readiness is represented.',art:{path:path.relative(root,imagePath),bytes:art.length,sha256:sha(art)},document:{bytes:Buffer.byteLength(html),gzipBytes:zlib.gzipSync(html).length,inlineCssBytes:[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].reduce((n,m)=>n+Buffer.byteLength(m[1]),0),inlineScriptBytes:[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].reduce((n,m)=>n+Buffer.byteLength(m[1]),0)},runs:[]};
async function run(engine,view){
 const viewport=views[view],mobile=viewport.width<768,browser=await engines[engine].launch();
 const result={engine,viewport:{name:view,...viewport},checks:[],screenshots:[],requests:[],unexpected:[],measurements:[]};report.runs.push(result);
 const record=name=>result.checks.push(name);let page,clockStarted=Date.now();const fixtureTime=()=>fixture.CLOCK+Date.now()-clockStarted;
 try{
  const context=await browser.newContext({viewport,isMobile:engine==='firefox'?false:mobile,hasTouch:mobile,reducedMotion:'reduce',serviceWorkers:'block'});
  const handleCommerce=createHandler({store:new MemoryStore(),catalog:{freshProduct:async()=>{throw Error('Cinematic captures must not hydrate or quote through commerce');}},config,now:()=>fixture.CLOCK,logger:{error(){}}});
  await context.addInitScript(()=>{
   Math.random=()=>.5;window.__cinematicCsp=[];window.__cinematicCLS=0;
   addEventListener('securitypolicyviolation',e=>window.__cinematicCsp.push(e.violatedDirective));
   try{new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.__cinematicCLS+=e.value;}).observe({type:'layout-shift',buffered:true});}catch{}
   if(location.hostname==='anox.app'&&!sessionStorage.getItem('cinematic-fixture-initialized')){sessionStorage.setItem('cinematic-fixture-initialized','1');sessionStorage.setItem('anox:auth:v1',JSON.stringify({idToken:'fixture-token',accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:Date.now()+3600000}));}
  });
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());result.requests.push({method:request.method(),path:url.pathname,query:url.search});
   const headers={'access-control-allow-origin':'https://anox.app','access-control-allow-headers':'Authorization,Content-Type,Idempotency-Key','access-control-allow-methods':'GET,OPTIONS','content-type':'application/json'};
   const send=(body,status=200)=>route.fulfill({status,headers,body:JSON.stringify(body)});
   if(url.hostname==='anox.app'&&request.method()==='GET'&&['/','/favicon.svg'].includes(url.pathname))return route.fulfill({contentType:url.pathname==='/favicon.svg'?'image/svg+xml':'text/html; charset=utf-8',body:url.pathname==='/favicon.svg'?favicon:html});
   if(url.hostname==='cdn.trychannel3.com'&&url.pathname==='/cinematic-fixture/jacket.svg'&&request.method()==='GET')return route.fulfill({contentType:imagePath.endsWith('.svg')?'image/svg+xml':'image/png',body:art});
   if(url.hostname==='cdn.trychannel3.com'&&['/cinematic-fixture/footwear.svg','/cinematic-fixture/beauty.svg'].includes(url.pathname)&&request.method()==='GET')return route.fulfill({contentType:'image/svg+xml',body:fs.readFileSync(path.join(root,'tests/fixtures/cinematic',path.basename(url.pathname)))});
   if(url.hostname==='zmumi2wruk.execute-api.us-east-2.amazonaws.com'){
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
    if(request.method()==='GET'&&url.pathname==='/catalog/search')return send(fixture.searchPage(url.searchParams.get('q'),fixtureTime()));
    if(request.method()==='GET'&&url.pathname.startsWith('/catalog/channel3/products/'))return send(fixture.detail(url.pathname.split('/').pop(),Object.fromEntries([...url.searchParams].filter(([k])=>k.startsWith('option_')).map(([k,v])=>[k.slice(7),v])),fixtureTime()));
    if(request.method()==='GET'&&url.pathname==='/catalog/products')return send({products:[],total:0,nextOffset:null});
    if(request.method()==='GET'&&url.pathname==='/me')return send({user:{displayName:'Preview account',email:'preview@example.test'}});
    if(request.method()==='GET'&&url.pathname==='/orders')return send({orders:[]});
    if(request.method()==='GET'&&['/commerce/capabilities','/commerce/orders'].includes(url.pathname)){const event=backendEvent('GET',url.pathname,undefined,{headers:request.headers(),queryStringParameters:Object.fromEntries(url.searchParams)});event.requestContext.authorizer.jwt.claims.exp=String(Math.floor(fixture.CLOCK/1000)+3600);if(!request.headers().authorization)delete event.requestContext.authorizer;const response=await handleCommerce(event);return route.fulfill({status:response.statusCode,headers:response.headers,body:response.body});}
   }
   result.unexpected.push(request.method()+' '+url.origin+url.pathname);return route.abort();
  });
  page=await context.newPage();clockStarted=Date.now();await page.clock.install({time:fixture.CLOCK});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const nav=async hash=>{if(await page.evaluate(hash=>location.hash==='#'+hash,hash))return;await page.evaluate(hash=>{window.__cinematicPreviousMain=document.querySelector('#main')?.firstElementChild;location.hash=hash;},hash);await page.waitForFunction(hash=>location.hash==='#'+hash&&document.querySelector('#main')?.firstElementChild!==window.__cinematicPreviousMain&&document.querySelector('#main')?.textContent.trim().length>0,hash);};
  const ready=()=>page.waitForFunction(()=>{const raw=location.hash.slice(1),at=raw.indexOf('?'),key=at<0?raw+'?':raw;return document.querySelector('#main')?.dataset.commerceDetailKey===key&&!!document.querySelector('[data-commerce-add]');});
  const product=async id=>{await nav('product/channel3/'+id);await ready();if(await page.locator('.commerce-main-image').count())await page.waitForFunction(()=>document.querySelector('.commerce-main-image')?.naturalWidth>0);};
  const capture=async(name,{full=false,anchor=null}={})=>{
   if(anchor)await page.locator(anchor).first().evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));else await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
   await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,items:[...document.querySelectorAll('#main *')].filter(n=>{const r=n.getBoundingClientRect();return r.width&&((r.left<-.5)||(r.right>innerWidth+.5));}).slice(0,8).map(n=>({tag:n.tagName,class:n.className}))}));
   assert.ok(overflow.scroll<=overflow.width,name+' fits viewport: '+JSON.stringify(overflow));
   const controls=await page.locator('[data-commerce-add],[data-commerce-wishlist],[data-commerce-gallery],[data-commerce-option],.v2-header-action').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,name:n.getAttribute('aria-label')||n.labels?.[0]?.textContent||n.textContent.trim(),control:n.outerHTML.slice(0,160)})));
   for(const control of controls){assert.ok(control.name,name+' control has accessible name');if(!report.baseline)assert.ok(control.width>=43.9&&control.height>=43.9,name+' primary target >=44px: '+JSON.stringify(control));}
   const metrics=await page.evaluate(()=>{const nav=performance.getEntriesByType('navigation')[0];return {labOnly:true,domContentLoadedMs:nav?.domContentLoadedEventEnd,loadMs:nav?.loadEventEnd,cumulativeLayoutShift:window.__cinematicCLS,resourceCount:performance.getEntriesByType('resource').length};});result.measurements.push({state:name,...metrics});
   if(out){fs.mkdirSync(out,{recursive:true});const file=`${engine}-${view}-${name}.png`;await page.screenshot({path:path.join(out,file),fullPage:full,animations:'disabled'});result.screenshots.push({state:name,file,fullPage:full});}
   record(name+' rendered layout and accessible control names');
  };
  const setTheme=async theme=>{if(await page.evaluate(()=>document.documentElement.dataset.theme)!==theme){await page.locator('button[data-theme]').filter({visible:true}).first().click();await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);}};
  const setLanguage=async lang=>{await page.locator('[data-language="'+lang+'"]').filter({visible:true}).first().click();await page.waitForFunction(lang=>document.documentElement.dir===(lang==='ar'?'rtl':'ltr'),lang);};
  await page.goto('https://anox.app/#product/channel3/cinematic-jacket');await ready();await page.waitForFunction(()=>document.querySelector('.commerce-main-image')?.naturalWidth>0);await setTheme('dark');
  assert.equal(result.requests.filter(r=>r.path.startsWith('/catalog/channel3/products/')).length,1,'PDP render makes one detail request');
  if(scenes.includes('pdp')){
   await capture('pdp');await capture('pdp-full',{full:true});await capture('pdp-actions',{anchor:'[data-commerce-add]'});
   await page.locator('[data-commerce-swipe]').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('[data-commerce-gallery="1"][aria-pressed="true"]').count(),1);
   await page.locator('[data-commerce-option="Size"]').selectOption('L');await ready();assert.equal(await page.locator('[data-commerce-option="Size"]').inputValue(),'L');
   assert.match(result.requests.filter(r=>r.path.startsWith('/catalog/channel3/products/')).at(-1).query,/option_Size=L/);
   assert.equal(await page.locator('[data-commerce-option="Size"] option[value="XL"]').isDisabled(),true,'out of stock option stays disabled');
   await page.locator('[data-commerce-wishlist]').click();assert.equal(await page.locator('[data-commerce-wishlist]').getAttribute('aria-pressed'),'true');
   await capture('pdp-selected',{anchor:'[data-commerce-add]'});record('gallery keyboard, source option refresh, disabled stock option and selected wishlist');
   await page.locator('[data-commerce-option="Size"]').selectOption('M');await ready();
  }
  if(scenes.includes('pdp-light')){await setTheme('light');await ready();await capture('pdp-light');await setTheme('dark');await ready();}
  if(scenes.includes('pdp-rtl')){await setLanguage('ar');await ready();await capture('pdp-rtl');await capture('pdp-rtl-full',{full:true});await setLanguage('en');await ready();}
  if(scenes.includes('pdp-long')){await product('cinematic-long');await capture('pdp-long');await capture('pdp-long-actions',{anchor:'[data-commerce-add]'});}
  if(scenes.includes('pdp-missing')){await product('cinematic-missing');await page.locator('.commerce-image-empty').waitFor();assert.equal(await page.locator('.commerce-main-image').count(),0);assert.equal(await page.locator('[data-commerce-add]').isDisabled(),true);assert.match(await page.locator('.v2-pdp-intro').textContent(),/Price unknown/);await capture('pdp-missing');record('missing image and unknown price retain truthful disabled state');}
  for(const kind of ['footwear','beauty'])if(scenes.includes('pdp-'+kind)){await product('cinematic-'+kind);await capture('pdp-'+kind);await capture('pdp-'+kind+'-actions',{anchor:'[data-commerce-add]'});}
  if(scenes.includes('home')){await nav('home');await page.waitForFunction(()=>document.querySelectorAll('.anox-home-grid .v2-product-card').length>0&&!/Loading products|جارٍ تحميل المنتجات/.test(document.querySelector('#main')?.textContent||''));await capture('home');await capture('home-full',{full:true});}
  if(scenes.includes('shop')){await nav('shop');await page.waitForFunction(()=>document.querySelectorAll('.v2-catalog-grid .v2-product-card').length>0);await capture('shop');await capture('shop-grid',{anchor:'.v2-catalog-grid'});record('catalog cards render without detail hydration');}
  if(scenes.includes('cart')){await product('cinematic-jacket');await page.locator('[data-commerce-add]').click();await nav('cart');await page.locator('[data-commerce-cart-quantity]').waitFor();await page.waitForFunction(()=>document.querySelector('[data-commerce-quote]')?.disabled===false);assert.equal(await page.locator('[data-commerce-checkout]').isDisabled(),true);await capture('cart');await capture('cart-full',{full:true});await page.reload();await page.locator('[data-commerce-cart-quantity]').waitFor();assert.equal(await page.locator('[data-commerce-cart-quantity]').inputValue(),'1');record('cart persists while payment collection remains disabled');}
  if(scenes.includes('account')){await nav('account');await page.waitForFunction(()=>document.querySelector('#main')?.textContent.includes('preview@example.test'));await capture('account');}
  for(const route of ['signin','request','orders','wishlist'])if(scenes.includes(route)){await nav(route);await capture(route);}
  for(const kind of ['search','assistant'])if(scenes.includes(kind)){await nav('home');await page.locator('[data-open="'+kind+'"]').filter({visible:true}).first().click();await page.locator('#dialog').waitFor({state:'visible'});await capture(kind);await page.keyboard.press('Escape');await page.locator('#dialog').waitFor({state:'hidden'});}
  if(scenes.includes('home-light')){await nav('home');await setTheme('light');await capture('home-light');await setTheme('dark');}
  if(scenes.includes('home-rtl')){await nav('home');await setLanguage('ar');await capture('home-rtl');await setLanguage('en');}
  if(scenes.includes('retailers')){
   for(const name of ['Nike','adidas','Sephora',"Levi's",'TJ Maxx','e.l.f. cosmetics']){
    await nav('search?q='+encodeURIComponent(name));await page.waitForFunction(()=>document.querySelectorAll('.v2-catalog-grid .v2-product-card').length>0);
    assert.equal((await page.locator('.v2-category-heading h1').textContent()).trim(),name);
    assert.equal(await page.locator('[data-cinema-retailer][aria-current="page"]').textContent(),name);
    assert.equal(await page.locator('[data-discovery-section][aria-current="page"]').count(),0);
    record(name+' collection identity and active retailer');
   }
   await nav('search?q=Nike');await capture('retailer-nike');await setLanguage('ar');await capture('retailer-nike-rtl');await setLanguage('en');
  }
  if(scenes.includes('pdp-stale')){await product('cinematic-stale');assert.equal(await page.locator('[data-commerce-add]').isEnabled(),true);await page.clock.runFor(31000);await page.waitForFunction(()=>document.querySelector('[data-commerce-add]')?.disabled===true);assert.equal(await page.locator('[data-retailer-link]').count(),0);assert.doesNotMatch(await page.locator('.v2-pdp-intro').textContent(),/\$220\.50/);await capture('pdp-stale');record('stale evidence removes actionable offer and price');}
  assert.deepEqual(errors,[],'no application runtime errors');assert.deepEqual(await page.evaluate(()=>window.__cinematicCsp),[],'production CSP remains intact');assert.deepEqual(result.unexpected,[],'all requests fulfilled locally');assert.equal(result.requests.filter(r=>!['GET','OPTIONS'].includes(r.method)).length,0,'no commerce/auth/provider writes');
  record('zero live requests, mutations, runtime errors or CSP violations');await context.close();console.log(`${engine} ${view}: ${result.checks.length} cinematic checks, ${result.screenshots.length} screenshots`);
 }catch(error){result.failure=error.message;if(page){result.pageState=await page.evaluate(()=>({hash:location.hash,theme:document.documentElement.dataset.theme,text:document.querySelector('#main')?.textContent.slice(0,1200)})).catch(()=>null);console.error(JSON.stringify({engine,view,failure:result.failure,pageState:result.pageState,lastRequests:result.requests.slice(-8)},null,2));if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`${engine}-${view}-failure.png`)}).catch(()=>{});}}throw error;}finally{await browser.close();}
}
(async()=>{try{for(const engine of(process.env.ENGINES||'chromium').split(',')){assert.ok(engines[engine],'known engine '+engine);for(const requested of(process.env.VIEWPORTS||'mobile,desktop').split(',')){const view=aliases[requested]||requested;assert.ok(views[view],'known viewport '+requested);await run(engine,view);}}}finally{if(out||process.env.REPORT_PATH){const file=process.env.REPORT_PATH?path.resolve(process.env.REPORT_PATH):path.join(out,'report.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');}}console.log(`${report.runs.length} cinematic viewport runs passed; ${report.runs.reduce((n,r)=>n+r.checks.length,0)} checks`);})().catch(error=>{console.error(error);process.exitCode=1;});
