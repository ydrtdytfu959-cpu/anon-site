#!/usr/bin/env node
'use strict';
// Loopback-only review server. The service worker blocks every external request.
// Production index.html is never written; fixture data stays on this origin.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),fixtures=require('../tests/fixtures/cinematic/catalog.cjs');
const {createHandler}=require('../backend/commerce/index.js');
const {MemoryStore,event,config}=require('../tests/helpers/commerce.cjs');
const commerce=createHandler({store:new MemoryStore(),catalog:{freshProduct:async()=>{throw Error('Preview is read only');}},config,logger:{error(){}}});
const bridge=`sessionStorage.setItem('anox:auth:v1',JSON.stringify({idToken:'fixture-token',accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:Date.now()+3600000}));document.addEventListener('click',e=>{const a=e.target.closest('a');if(a&&/^(https?:|mailto:)/.test(a.getAttribute('href')||'')){e.preventDefault();alert('Offline preview: external links are disabled.');}},true);`;
function previewHtml(){
 let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 html=html.replace('connect-src ',"connect-src 'self' " );
 const original=require('./build-catalog.cjs').scripts(html)[0];
 // Bookmarked/direct URLs must not initialize production clients before isolation.
 // A worker for another scope is not sufficient: require this preview's controller.
 const script="if(!navigator.serviceWorker?.controller||navigator.serviceWorker.controller.scriptURL!==location.origin+'/preview/sw.js'){location.replace('/preview/start.html');}else{\n"+bridge+'\n'+original+'\n}';
 html=html.replace(original,()=>script);
 html=html.replace(/'sha256-[^']+'/,"'sha256-"+crypto.createHash('sha256').update(script).digest('base64')+"'");
 html=html.replace('</body>','<aside style="position:fixed;z-index:9999;bottom:0;inset-inline:0;text-align:center;background:#f3e8ad;color:#24200f;font:11px/1.4 system-ui;padding:3px;pointer-events:none">OFFLINE DESIGN PREVIEW · SYNTHETIC DATA · NO LIVE SERVICES</aside></body>');
 return html;
}
const worker=`self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin===location.origin){if(u.pathname.startsWith('/preview/')||u.pathname.startsWith('/fixture/')||u.pathname==='/favicon.svg')e.respondWith(fetch(e.request));else e.respondWith(new Response('Preview path blocked',{status:403}));return;}if(e.request.method!=='GET'&&e.request.method!=='OPTIONS'){e.respondWith(new Response(JSON.stringify({error:'OFFLINE_PREVIEW_READ_ONLY'}),{status:403,headers:{'content-type':'application/json'}}));return;}if(u.hostname==='cdn.trychannel3.com'&&u.pathname.startsWith('/cinematic-fixture/')){e.respondWith(fetch('/fixture/art/'+u.pathname.split('/').pop().replace('.svg','')));return;}if(u.hostname==='zmumi2wruk.execute-api.us-east-2.amazonaws.com'){e.respondWith(fetch('/fixture/api'+u.pathname+u.search));return;}e.respondWith(new Response('External request blocked by offline review',{status:403}));});`;
function createServer(){return http.createServer(async(req,res)=>{
 const send=(body,type='text/html; charset=utf-8',status=200)=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(body);};
 try{
  if(req.method!=='GET')return send('Read-only preview','text/plain',405);
  const url=new URL(req.url,'http://127.0.0.1'),p=url.pathname;
  if(p==='/preview/'||p==='/preview/start.html')return send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AnoX offline preview</title><style>body{background:#090b0f;color:#f3f4f6;font:18px/1.7 system-ui;padding:40px;max-width:650px;margin:auto}a{color:#aac4ef}button{font:inherit;padding:12px;border-radius:12px}</style><h1>AnoX · Cinematic Commerce</h1><p>This interactive preview uses synthetic products and an isolated preview account. External requests and all server writes are blocked. The production website and customer data are untouched.</p><p id="status">Preparing the offline application…</p><a href="/docs/cinematic/preview.html">Before-and-after review</a><script>navigator.serviceWorker.register('/preview/sw.js',{scope:'/preview/'}).then(()=>navigator.serviceWorker.ready).then(()=>{const a=document.createElement('a');a.href='/preview/index.html#product/channel3/cinematic-jacket';a.textContent='Open interactive preview →';document.querySelector('#status').replaceChildren(a);}).catch(()=>{document.querySelector('#status').textContent='Service workers are unavailable; use the screenshot review instead.';});</script>`);
  if(p==='/preview/sw.js')return send(worker,'application/javascript');
  if(p==='/preview/index.html')return send(previewHtml());
  if(p==='/favicon.svg')return send(fs.readFileSync(path.join(root,'favicon.svg')),'image/svg+xml');
  if(['/tests/fixtures/cinematic/PROVENANCE.md','/docs/design/CINEMATIC-3-CONTINUATION.md'].includes(p))return send(fs.readFileSync(path.join(root,p.slice(1))),'text/plain; charset=utf-8');
  if(p.startsWith('/fixture/art/')){
   const name=p.slice('/fixture/art/'.length),file={jacket:'jacket-preview.png',footwear:'footwear.svg',beauty:'beauty.svg'}[name];
   if(!file)return send('Unknown fixture','text/plain',404);
   return send(fs.readFileSync(path.join(root,'tests/fixtures/cinematic',file)),file.endsWith('.svg')?'image/svg+xml':'image/png');
  }
  if(p.startsWith('/fixture/api/')){
   const api=p.slice('/fixture/api'.length),now=Date.now();let body;
   if(api==='/catalog/search')body={provider:'channel3',data:{products:Array.from({length:4},(_,i)=>fixtures.searchProduct(url.searchParams.get('q'),i)),next_page_token:null},fetchedAt:new Date(now).toISOString(),expiresAt:new Date(now+240000).toISOString()};
   else if(api.startsWith('/catalog/channel3/products/'))body=fixtures.detail(api.split('/').pop(),Object.fromEntries([...url.searchParams].filter(([k])=>k.startsWith('option_')).map(([k,v])=>[k.slice(7),v])),now);
   else if(api==='/catalog/products')body={products:[],total:0,nextOffset:null};
   else if(api==='/me')body={user:{displayName:'Preview account',email:'preview@example.test'}};
   else if(api==='/orders')body={orders:[]};
   else if(['/commerce/capabilities','/commerce/orders'].includes(api)){const input=event('GET',api);input.requestContext.authorizer.jwt.claims.exp=String(Math.floor(now/1000)+3600);const result=await commerce(input);return send(result.body,'application/json',result.statusCode);}
   else return send(JSON.stringify({error:'OFFLINE_PREVIEW_UNAVAILABLE'}),'application/json',503);
   return send(JSON.stringify(body),'application/json');
  }
  // Only public review documents are served. Never expose source credentials or arbitrary paths.
  if(p.startsWith('/docs/cinematic/')&&!p.includes('..')){
   const relative=decodeURIComponent(p.slice(1)),file=path.resolve(root,relative),base=path.join(root,'docs/cinematic')+path.sep;
   if(!file.startsWith(base)||!fs.existsSync(file)||!fs.statSync(file).isFile())return send('Not found','text/plain',404);
   const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.png':'image/png','.json':'application/json','.md':'text/plain'};
   const type=types[path.extname(file)];if(!type)return send('Not found','text/plain',404);return send(fs.readFileSync(file),type);
  }
  return send('Not found','text/plain',404);
 }catch{return send('Preview unavailable','text/plain',500);}
});}
module.exports={createServer,previewHtml,worker};
if(require.main===module){const port=Number(process.env.PORT||8787);createServer().listen(port,'127.0.0.1',()=>console.log('Offline review: http://127.0.0.1:'+port+'/preview/'));}
