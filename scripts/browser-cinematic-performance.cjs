#!/usr/bin/env node
'use strict';
// Reproducible, isolated laboratory comparison. This is not field Core Web Vitals.
// Every response is a local fixture; CPU/latency simulation never contacts a provider.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),fixtures=require('../tests/fixtures/cinematic/catalog.cjs');
const root=path.resolve(__dirname,'..'),baselinePath=path.resolve(process.env.BASELINE_HTML||'/private/tmp/anox-cinematic-baseline.html');
const output=path.resolve(process.env.PERFORMANCE_REPORT||path.join(root,'docs/cinematic/evidence/performance.json'));
const sources={baseline:fs.readFileSync(baselinePath,'utf8'),candidate:fs.readFileSync(path.join(root,'index.html'),'utf8')};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const payload=html=>({sha256:hash(html),htmlBytes:Buffer.byteLength(html),gzipBytes:zlib.gzipSync(html).length,inlineCssBytes:[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].reduce((sum,m)=>sum+Buffer.byteLength(m[1]),0),inlineScriptBytes:[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].reduce((sum,m)=>sum+Buffer.byteLength(m[1]),0)});
const report={generatedAt:new Date().toISOString(),scope:'Isolated Chromium laboratory comparison using actual HTML/CSP, original synthetic artwork and identical local fixture responses. No fake clock. Not production, real-user Core Web Vitals, Safari performance or a real mobile device.',environment:{node:process.version,platform:process.platform,arch:process.arch,viewport:{width:390,height:844},deviceScaleFactor:1,iterations:3,profiles:{standard:{cpuRate:1,responseDelayMs:0},constrained:{cpuRate:4,responseDelayMs:150}}},source:{baseline:payload(sources.baseline),candidate:payload(sources.candidate)},runs:[],fallbacks:[],failures:[],warnings:[]};
const assets={jacket:fs.readFileSync(path.join(root,'tests/fixtures/cinematic/jacket-preview.png')),footwear:fs.readFileSync(path.join(root,'tests/fixtures/cinematic/footwear.svg')),beauty:fs.readFileSync(path.join(root,'tests/fixtures/cinematic/beauty.svg'))};
const median=items=>{const sorted=[...items].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];};
const check=(condition,message)=>{if(!condition)report.failures.push(message);};
async function setup(browser,variant,profile){
 const settings=report.environment.profiles[profile],context=await browser.newContext({viewport:report.environment.viewport,deviceScaleFactor:1,isMobile:true,hasTouch:true,serviceWorkers:'block'}),requests=[],errors=[],unexpected=[];
 await context.addInitScript(()=>{
  window.__lab={lcp:0,cls:0,longTasks:[],events:[],csp:[]};
  for(const [type,record] of [['largest-contentful-paint',e=>window.__lab.lcp=e.startTime],['layout-shift',e=>{if(!e.hadRecentInput)window.__lab.cls+=e.value;}],['longtask',e=>window.__lab.longTasks.push({start:e.startTime,duration:e.duration})],['event',e=>{if(e.interactionId)window.__lab.events.push({name:e.name,duration:e.duration,interactionId:e.interactionId});}]]){
   try{new PerformanceObserver(list=>list.getEntries().forEach(record)).observe({type,buffered:true,durationThreshold:16});}catch{}
  }
  addEventListener('securitypolicyviolation',e=>window.__lab.csp.push(e.violatedDirective));
  sessionStorage.setItem('anox:auth:v1',JSON.stringify({idToken:'fixture-token',accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:Date.now()+3600000}));
 });
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),entry={method:request.method(),host:url.hostname,path:url.pathname,query:url.search,responseBytes:0};requests.push(entry);
  const send=async(body,contentType='application/json',status=200)=>{if(typeof body!=='string'&&!Buffer.isBuffer(body))body=JSON.stringify(body);entry.responseBytes=Buffer.byteLength(body);if(settings.responseDelayMs)await new Promise(resolve=>setTimeout(resolve,settings.responseDelayMs));return route.fulfill({status,contentType,headers:{'access-control-allow-origin':'https://anox.app','access-control-allow-headers':'Authorization,Content-Type,Idempotency-Key','access-control-allow-methods':'GET,OPTIONS','timing-allow-origin':'*'},body});};
  if(request.method()==='OPTIONS')return send('', 'text/plain',204);
  if(request.method()!=='GET'){unexpected.push(entry);return route.abort();}
  if(url.hostname==='anox.app'&&url.pathname==='/')return send(sources[variant],'text/html; charset=utf-8');
  if(url.hostname==='anox.app'&&url.pathname==='/favicon.svg')return send(fs.readFileSync(path.join(root,'favicon.svg')),'image/svg+xml');
  if(url.hostname==='cdn.trychannel3.com'&&url.pathname.startsWith('/cinematic-fixture/')){const name=path.basename(url.pathname,'.svg');if(assets[name])return send(assets[name],name==='jacket'?'image/png':'image/svg+xml');}
  if(url.hostname==='zmumi2wruk.execute-api.us-east-2.amazonaws.com'){
   if(url.pathname.startsWith('/catalog/channel3/products/'))return send(fixtures.detail(url.pathname.split('/').pop(),Object.fromEntries([...url.searchParams].filter(([k])=>k.startsWith('option_')).map(([k,v])=>[k.slice(7),v])),Date.now()));
   if(url.pathname==='/catalog/search')return send({provider:'channel3',data:{products:Array.from({length:4},(_,n)=>fixtures.searchProduct(url.searchParams.get('q'),n)),next_page_token:null},fetchedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString()});
   if(url.pathname==='/catalog/products')return send({products:[],total:0,nextOffset:null});
   if(url.pathname==='/me')return send({user:{displayName:'Preview account',email:'preview@example.test'}});
   if(url.pathname==='/orders'||url.pathname==='/commerce/orders')return send({orders:[]});
   if(url.pathname==='/commerce/capabilities')return send({checkoutEnabled:false,serviceFee:{currency:'USD',amount:500,appliesOn:'owner_decision_pending',collectionEnabled:false}});
  }
  unexpected.push(entry);return route.abort();
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:settings.cpuRate});
 return {context,page,cdp,requests,errors,unexpected};
}
async function ready(page){await page.waitForFunction(()=>document.querySelector('[data-commerce-add]')&&!document.querySelector('[data-commerce-add]').disabled&&document.querySelector('.commerce-main-image')?.naturalWidth>0);await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function snapshot(page){return page.evaluate(()=>({navigation:performance.getEntriesByType('navigation')[0]?.toJSON(),lcpMs:window.__lab.lcp,cls:window.__lab.cls,longTasks:window.__lab.longTasks,events:window.__lab.events,csp:window.__lab.csp,domNodes:document.querySelectorAll('*').length,documentWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth,resourceCount:performance.getEntriesByType('resource').length}));}
async function run(browser,variant,profile,iteration){
 const lab=await setup(browser,variant,profile),{page,context,cdp,requests,errors,unexpected}=lab;
 const result={variant,profile,iteration};report.runs.push(result);
 try{
  await page.goto('https://anox.app/#product/channel3/cinematic-jacket');await ready(page);await page.waitForTimeout(500);
  result.startup=await snapshot(page);result.startupRequests=requests.map(r=>({...r}));
  assert.equal(requests.filter(r=>r.path.startsWith('/catalog/channel3/products/')).length,1,'one initial detail request');
  const button=page.locator('[data-commerce-wishlist]');await button.scrollIntoViewIfNeeded();await page.evaluate(()=>window.__labInteractionStart=performance.now());await button.click();await page.waitForFunction(()=>document.querySelector('[data-commerce-wishlist]')?.getAttribute('aria-pressed')==='true');
  result.wishlistCommitMs=await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve(performance.now()-window.__labInteractionStart))));
  await cdp.send('HeapProfiler.collectGarbage');const first=await cdp.send('Runtime.getHeapUsage');result.repeatRoutes={beforeBytes:first.usedSize,cycles:5,firstDomNodes:(await snapshot(page)).domNodes};
  for(let i=0;i<5;i++){
   await page.evaluate(()=>location.hash='account');await page.waitForFunction(()=>document.querySelector('#main')?.textContent.includes('preview@example.test'));
   await page.evaluate(()=>location.hash='product/channel3/cinematic-jacket');await ready(page);
  }
  await cdp.send('HeapProfiler.collectGarbage');result.repeatRoutes.afterBytes=(await cdp.send('Runtime.getHeapUsage')).usedSize;result.repeatRoutes.finalDomNodes=(await snapshot(page)).domNodes;
  result.final=await snapshot(page);result.requests=requests;result.syntheticResponseBytes=requests.reduce((sum,r)=>sum+r.responseBytes,0);result.detailRequests=requests.filter(r=>r.path.startsWith('/catalog/channel3/products/')).length;result.unexpected=unexpected;result.errors=errors;
  assert.deepEqual(unexpected,[],'no network requests escape fixture allowlist');assert.deepEqual(errors,[],'no runtime errors');assert.deepEqual(result.final.csp,[],'no CSP violations');assert.ok(result.repeatRoutes.finalDomNodes<=result.repeatRoutes.firstDomNodes+5,'route cycles do not accumulate DOM nodes');
  console.log(`${variant} ${profile} ${iteration}: LCP ${result.startup.lcpMs.toFixed(0)} ms, CLS ${result.startup.cls.toFixed(4)}, detail calls ${result.detailRequests}`);
 }finally{await context.close();}
}
async function fallbacks(browser){
 const {page,context,cdp,unexpected,errors}=await setup(browser,'candidate','standard');
 const capture=async name=>{const state=await page.evaluate(()=>{const panel=document.querySelector('.cinema-product-panel'),image=document.querySelector('.commerce-main-image'),nav=document.querySelector('.mobile-nav');return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,mainScroll:document.querySelector('#main').scrollWidth,panel:{background:getComputedStyle(panel).backgroundColor,filter:getComputedStyle(panel).backdropFilter,color:getComputedStyle(panel).color,border:getComputedStyle(panel).borderTopWidth},imageAnimation:getComputedStyle(image).animationDuration,navFilter:getComputedStyle(nav).backdropFilter,media:{motion:matchMedia('(prefers-reduced-motion:reduce)').matches,transparency:matchMedia('(prefers-reduced-transparency:reduce)').matches,forced:matchMedia('(forced-colors:active)').matches},overflow:[...document.querySelectorAll('#main *')].filter(n=>{const r=n.getBoundingClientRect();return r.width&&(r.left<-.5||r.right>innerWidth+.5);}).slice(0,8).map(n=>({tag:n.tagName,class:n.className}))};});report.fallbacks.push({name,...state});return state;};
 try{
  await page.goto('https://anox.app/#product/channel3/cinematic-jacket');await ready(page);
  await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'},{name:'prefers-reduced-transparency',value:'reduce'}]});
  let state=await capture('reduced-motion-and-transparency');check(state.media.motion&&state.media.transparency,'Chromium media emulation must apply');check(state.panel.filter==='none'&&state.navFilter==='none','Reduced transparency removes glass blur');check(!state.panel.background.startsWith('rgba('),'Reduced transparency panel is opaque');check(parseFloat(state.imageAnimation)<=.001,'Reduced motion suppresses image entrance animation');
  await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});state=await capture('forced-colors');check(state.media.forced,'Forced colors emulation must apply');check(state.panel.filter==='none'&&parseFloat(state.panel.border)>=1,'High contrast retains a visible panel boundary without blur');
  await cdp.send('Emulation.setEmulatedMedia',{features:[]});await page.evaluate(()=>document.documentElement.style.fontSize='200%');state=await capture('200-percent-root-text');check(state.scrollWidth<=state.width,'200% root text fits document viewport');
  await page.evaluate(()=>document.documentElement.style.fontSize='');await page.setViewportSize({width:320,height:560});state=await capture('narrow-320');check(state.scrollWidth<=state.width,'320px layout fits viewport');
  await page.locator('[data-open="search"]').filter({visible:true}).first().click();await page.locator('#dialog').waitFor({state:'visible'});const input=page.locator('#dialog input').first();await input.focus();await page.setViewportSize({width:320,height:360});await input.scrollIntoViewIfNeeded();
  const keyboard=await input.evaluate(el=>{const r=el.getBoundingClientRect();return {focused:document.activeElement===el,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth};});report.fallbacks.push({name:'reduced-height-search-keyboard-proxy',...keyboard});check(keyboard.focused&&keyboard.top>=0&&keyboard.bottom<=keyboard.height,'Search field remains visible in keyboard-height proxy');await page.keyboard.press('Escape');await page.locator('#dialog').waitFor({state:'hidden'});
  assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
 }finally{await context.close();}
}
(async()=>{
 const browser=await chromium.launch();report.environment.browser=browser.version();
 try{for(const profile of ['standard','constrained'])for(let i=1;i<=3;i++)for(const variant of ['baseline','candidate'])await run(browser,variant,profile,i);await fallbacks(browser);
  report.summary={};for(const profile of ['standard','constrained']){report.summary[profile]={};for(const variant of ['baseline','candidate']){const runs=report.runs.filter(r=>r.profile===profile&&r.variant===variant);report.summary[profile][variant]={medianLcpMs:median(runs.map(r=>r.startup.lcpMs)),medianCls:median(runs.map(r=>r.startup.cls)),medianDOMContentLoadedMs:median(runs.map(r=>r.startup.navigation.domContentLoadedEventEnd)),medianStartupLongTaskMs:median(runs.map(r=>r.startup.longTasks.reduce((n,t)=>n+t.duration,0))),medianWishlistCommitMs:median(runs.map(r=>r.wishlistCommitMs)),maxEventTimingMs:Math.max(0,...runs.flatMap(r=>r.final.events.map(e=>e.duration))),medianHeapGrowthBytes:median(runs.map(r=>r.repeatRoutes.afterBytes-r.repeatRoutes.beforeBytes)),medianStartupResponseBytes:median(runs.map(r=>r.startupRequests.reduce((sum,q)=>sum+q.responseBytes,0))),detailRequests:runs.map(r=>r.detailRequests)};}
   const b=report.summary[profile].baseline,c=report.summary[profile].candidate;check(c.medianLcpMs<=Math.max(b.medianLcpMs*1.75,b.medianLcpMs+1000),`${profile}: material startup LCP regression`);check(c.medianCls<=Math.max(.1,b.medianCls+.03),`${profile}: material lab CLS regression`);check(Math.max(...c.detailRequests)<=Math.max(...b.detailRequests),`${profile}: route cycling increases detail requests`);if(c.medianLcpMs>2500)report.warnings.push(`${profile}: simulated median LCP exceeds 2.5 seconds; this is laboratory evidence only`);
  }
  check(report.source.candidate.gzipBytes<=report.source.baseline.gzipBytes*1.08,'compressed document grows more than 8%');
 }catch(error){report.failures.push(error.stack||error.message);}finally{await browser.close();fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify({summary:report.summary,failures:report.failures,warnings:report.warnings},null,2));if(report.failures.length)process.exitCode=1;
})();
