const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Exercise the shipped registry/repository, with only the external provider replaced.
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = html.slice(html.indexOf('    const CATALOG_LIMITS='), html.indexOf('    /* PRODUCTION COMMERCE TRUST BOUNDARY'));
const whole = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const {ProductProviderRegistry, CatalogRepository} = new Function('isObject','whole','requireInteger','text','safeURL','normalizedDate','CATEGORIES','DEVELOPER_MODE','clone', source + ';return {ProductProviderRegistry,CatalogRepository};')(
  x => !!x && typeof x === 'object' && !Array.isArray(x), whole,
  (n,min,max,label) => { if (!whole(n,min,max)) throw Error(label); return n; },
  (x,n=200) => typeof x === 'string' ? x.slice(0,n) : '',
  x => typeof x === 'string' && x.startsWith('https://') ? x : '',
  x => typeof x === 'string' && Number.isFinite(Date.parse(x)) ? new Date(x).toISOString() : null,
  {Shoes:{}}, false, structuredClone
);
const searchSource=html.slice(html.indexOf('    function normalizeSearch('),html.indexOf('    /* UI-facing search service:'));
const LocalSearchIndex=new Function('text','CATEGORIES','COLORS',searchSource+';return LocalSearchIndex;')((x,n)=>String(x||'').slice(0,n),{Shoes:{ar:'Shoes',en:'Shoes'}},{});
const item = id => ({id,slug:id,name:{ar:id,en:id},brand:'Example',category:'Shoes',kind:'shoes',currency:'USD',priceCents:1000,weightGrams:0,variants:[{color:'Black',size:'M',stock:0}],description:{ar:id,en:id},media:[{url:'https://cdn.trychannel3.com/a.jpg',width:420,height:390}],source:{merchantUrl:'https://buy.trychannel3.com/item/'+id,verifiedAt:new Date().toISOString()},purchasable:false});
const page = (ids, nextCursor=null) => ({items:ids.map(item),nextCursor,total:null,fetchedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString(),invalidCount:0});
function setup(list) {
  const registry = new ProductProviderRegistry();
  registry.register({id:'channel3-live',mode:'live',transport:'api',pagination:'cursor',eager:false,list});
  return {registry,repo:new CatalogRepository(registry)};
}
function deferred() { let resolve; const promise = new Promise(r=>resolve=r); return {promise,resolve}; }

test('registry preserves opaque cursors and cursor error codes alongside offset providers', async()=>{
  const requests=[];
  const {registry}=setup(async options=>{requests.push(options);return page(['a'],' opaque +/= ');});
  const first=await registry.page('channel3-live',{q:'boots',section:'',limit:24,cursor:null,filters:{}});
  assert.equal(first.nextCursor,' opaque +/= ');
  assert.equal(first.status,'ready');
  assert.equal(requests[0].q,'boots');
  assert.equal(requests[0].offset,undefined);
  registry.register({id:'old',mode:'preview',transport:'offline',list:async({offset,limit})=>({items:[item('old')],total:3,nextOffset:offset+limit})});
  const legacy=await registry.page('old',0,1);
  assert.equal(legacy.nextOffset,1);
  const broken=setup(async()=>{throw Object.assign(Error('catalog_cursor_expired'),{code:'catalog_cursor_expired',status:410});});
  assert.equal((await broken.registry.page('channel3-live',{q:'boots',limit:24,cursor:'x'})).errors[0],'catalog_cursor_expired');
});

test('three cursor pages deduplicate stable ids and stop at the explicit end',async()=>{
  const requests=[];
  const {repo}=setup(async options=>{requests.push(options);return options.cursor===null?page(['a','b'],'two'):options.cursor==='two'?page(['b','c'],'three'):page(['d']);});
  await repo.loadLivePage({query:'boots'});
  await repo.loadLivePage({query:'boots',append:true});
  await repo.loadLivePage({query:'boots',append:true});
  await repo.loadLivePage({query:'boots',append:true});
  assert.deepEqual(repo.liveSource('boots').map(p=>p.id),['channel3-live__a','channel3-live__b','channel3-live__c','channel3-live__d']);
  assert.deepEqual(requests.map(r=>r.cursor),[null,'two','three']);
  assert.equal(repo.liveNextCursor,null);
  assert.equal(repo.providerStatus('channel3-live'),'ready');
  assert.equal(repo.providerStatus('nike-live'),'unavailable');
});

test('sparse cursor chains can pass twenty-one pages without inventing an end',async()=>{
  for(const limit of [1,24]){
    let calls=0;
    const {repo}=setup(async()=>{calls++;return page(['p'+calls],'cursor'+calls);});
    await repo.loadLivePage({query:'sparse',limit});
    for(let i=1;i<22;i++)await repo.loadLivePage({query:'sparse',limit,append:true});
    assert.equal(calls,22);assert.equal(repo.liveRecords.length,22);assert.equal(repo.liveNextCursor,'cursor22');
  }
});

test('reloading eager local providers preserves the active Channel3 provider status and continuation',async()=>{
  const {registry,repo}=setup(async()=>page(['a'],'next'));
  registry.register({id:'preview',mode:'preview',transport:'offline',list:async()=>({items:[item('local')],total:1,nextOffset:null})});
  await repo.loadLivePage({section:'men'});
  await repo.load();
  assert.equal(repo.providerStatus('channel3-live'),'ready');
  assert.equal(repo.providerStatus('preview'),'ready');
  assert.equal(repo.liveNextCursor,'next');assert.equal(repo.liveSection,'men');
  assert.equal(repo.get('channel3-live__a').id,'channel3-live__a');
});

test('discovery sections and search retain independent chains and canonical filter keys',async()=>{
  const requests=[];
  const {repo}=setup(async options=>{requests.push(options);return page([options.q||options.section],(options.q||options.section)+'-next');});
  await repo.loadLivePage({section:'men'});
  await repo.loadLivePage({section:'women'});
  await repo.loadLivePage({query:'men'});
  await repo.loadLivePage({section:'men'});
  assert.equal(requests.length,3);
  await repo.loadLivePage({section:'men',append:true});
  assert.equal(requests[3].cursor,'men-next');
  assert.equal(requests[3].section,'men');
  assert.equal(repo.get('channel3-live__women').id,'channel3-live__women');
  await repo.loadLivePage({query:'x',filters:{a:1,b:2}});
  await repo.loadLivePage({query:'x',filters:{b:2,a:1}});
  assert.equal(requests.length,5);
});

test('equivalent NFC and whitespace queries reuse one chain without changing case',async()=>{
  const requests=[];
  const {repo}=setup(async options=>{requests.push(options);return page(['a'],'next');});
  await repo.loadLivePage({query:' running  shoes '});
  await repo.loadLivePage({query:'running shoes'});
  assert.equal(requests.length,1);assert.equal(requests[0].q,'running shoes');
  assert.equal(repo.usingLive(' running  shoes '),true);
  await repo.loadLivePage({query:'cafe\u0301'});
  await repo.loadLivePage({query:'café'});
  assert.equal(requests.length,2);
  await repo.loadLivePage({query:'Café'});assert.equal(requests.length,3);
});

test('simultaneous append requests coalesce and changing context aborts stale work',async()=>{
  const slow=deferred(),requests=[];
  const {repo}=setup(async options=>{requests.push(options);return options.cursor==='next'?slow.promise:page([options.q||'a'],'next');});
  await repo.loadLivePage({query:'first'});
  const one=repo.loadLivePage({query:'first',append:true}),two=repo.loadLivePage({query:'first',append:true});
  await Promise.resolve();
  assert.equal(one,two);
  await repo.loadLivePage({query:'second'});
  assert.equal(requests[1].signal.aborted,true);
  slow.resolve(page(['stale']));await one;
  assert.deepEqual(repo.liveRecords.map(p=>p.id),['channel3-live__second']);
  assert.equal(repo.liveQuery,'second');
  assert.equal(repo.get('channel3-live__stale'),undefined);
});

test('append failures preserve products and cursor, with deliberate retry and explicit invalid restart',async()=>{
  let fail=true,invalid=false;const requests=[];
  const {repo}=setup(async options=>{requests.push(options);if(options.cursor&&fail)throw Object.assign(Error(invalid?'catalog_cursor_invalid':'offline'),{code:invalid?'catalog_cursor_invalid':'offline'});return page(['a'],options.cursor?null:'next');});
  await repo.loadLivePage({section:'shoes'});
  await repo.loadLivePage({section:'shoes',append:true});
  assert.equal(repo.liveRecords.length,1);assert.equal(repo.liveNextCursor,'next');assert.equal(repo.liveStatus,'partial');
  await repo.loadLivePage({section:'shoes'});assert.equal(requests.length,2);
  invalid=true;await repo.loadLivePage({section:'shoes',append:true});
  assert.equal(repo.liveRestartRequired,true);
  await repo.loadLivePage({section:'shoes',append:true});assert.equal(requests.length,3);
  fail=false;await repo.loadLivePage({section:'shoes',restart:true});
  assert.equal(requests[3].cursor,null);assert.equal(repo.liveRestartRequired,false);
});

test('empty first page retains its usable cursor and expiry needs an explicit restart',async()=>{
  let calls=0;
  const {repo}=setup(async()=>{calls++;return {...page([], 'next'),expiresAt:new Date(Date.now()-1).toISOString()};});
  await repo.loadLivePage({section:'beauty'});
  assert.equal(repo.liveNextCursor,'next');
  await repo.loadLivePage({section:'beauty',append:true});
  assert.equal(calls,1);assert.equal(repo.liveRestartRequired,true);
});

test('a failed explicit restart cannot reactivate an invalid continuation',async()=>{
  let calls=0;
  const {repo}=setup(async options=>{calls++;if(calls===1)return page(['a'],'invalid');if(options.cursor)throw Error('catalog_cursor_invalid');throw Error('offline');});
  await repo.loadLivePage({query:'x'});await repo.loadLivePage({query:'x',append:true});
  await repo.loadLivePage({query:'x',restart:true});
  assert.equal(repo.liveRecords.length,1);assert.equal(repo.liveRestartRequired,true);
  await repo.loadLivePage({query:'x',append:true});assert.equal(calls,3);
});

test('a cursor cycle stops without discarding already accepted pages',async()=>{
  const {repo}=setup(async options=>options.cursor===null?page(['a'],'first'):options.cursor==='first'?page(['b'],'second'):page(['c'],'first'));
  await repo.loadLivePage({query:'x'});await repo.loadLivePage({query:'x',append:true});await repo.loadLivePage({query:'x',append:true});
  assert.equal(repo.liveRestartRequired,true);
  assert.deepEqual(repo.liveRecords.map(p=>p.id),['channel3-live__a','channel3-live__b']);
});

test('context retention is bounded and reset aborts pending work without a late state write',async()=>{
  const slow=deferred();let last;
  const {repo}=setup(async options=>{last=options;return options.q==='slow'?slow.promise:page([options.q]);});
  for(let i=0;i<20;i++)await repo.loadLivePage({query:'q'+i});
  assert.ok(repo.liveContexts.size<=6);
  const pending=repo.loadLivePage({query:'slow'});await Promise.resolve();repo.resetLive();
  assert.equal(last.signal.aborted,true);slow.resolve(page(['late']));await pending;
  assert.equal(repo.liveStatus,'idle');assert.equal(repo.liveRecords.length,0);assert.equal(repo.get('channel3-live__late'),undefined);
});

test('retained context details are excluded from active presentation and search suggestions',async()=>{
  const {repo}=setup(async options=>page([options.section]));
  await repo.loadLivePage({section:'men'});await repo.loadLivePage({section:'women'});
  assert.deepEqual(repo.all().map(p=>p.id),['channel3-live__women']);
  assert.equal(repo.get('channel3-live__men').id,'channel3-live__men');
  const index=new LocalSearchIndex(repo);
  assert.equal(index.search('men').length,0);
  assert.deepEqual(index.search('women').map(p=>p.id),['channel3-live__women']);
});

test('active expiry invalidates cached search results without a rebuild or a route change',async()=>{
  const originalNow=Date.now;let clock=originalNow();Date.now=()=>clock;
  try{
    const {repo}=setup(async()=>page(['alpine']));await repo.loadLivePage({query:'alpine'});
    const index=new LocalSearchIndex(repo);assert.equal(index.search('alpine').length,1);
    clock+=300001;
    assert.equal(index.search('alpine').length,0);assert.equal(repo.all().length,0);assert.equal(repo.liveSource('alpine').length,0);
    assert.equal(repo.get('channel3-live__alpine').id,'channel3-live__alpine');
  }finally{Date.now=originalNow;}
});

test('brand clicks preserve the active discovery section',()=>{
  const start=html.indexOf('if(target.matches("[data-brand]"))'),end=html.indexOf('if(target.matches("[data-clear-filters]"))',start);
  let destination;
  new Function('target','data','ui','defaultFilters','navigate','Catalog','liveSectionForRoute',html.slice(start,end))({matches:()=>true},{brand:'Example'},{},()=>({}),(...args)=>{destination=args;},{liveSection:'brands'},()=> 'brands');
  assert.deepEqual(destination,['shop',{brand:'Example',section:'brands'}]);
});

test('search filter drawer counts the same active server results as the grid',()=>{
  const block=html.slice(html.indexOf('function openFilters(){'),html.indexOf('function V2SetChoice('));
  let markup;
  new Function('currentRoute','V2ChoiceResults','filteredProducts','searchCatalog','Catalog','openDialog','tx','filterMarkup','button','catalogPresentationSource',block+';openFilters();')(
    ()=>({name:'search',params:new URLSearchParams('q=running')}),p=>p,p=>p,()=>[],{all:()=>[{id:'inactive'},{id:'active'}],liveSource:()=>[{id:'active'}]},(_type,_label,html)=>{markup=html;},(_ar,en)=>en,()=>'',label=>label,()=>[{id:'active'}]
  );
  assert.ok(markup.includes('Show products · 1'));
});

test('cursor ingestion still rejects a page exceeding the declared pixel budget',async()=>{
  const {registry}=setup(async()=>page(Array.from({length:25},(_,i)=>'x'+i)));
  const result=await registry.page('channel3-live',{q:'x',limit:24,cursor:null});
  assert.equal(result.status,'unavailable');
  assert.equal(result.errors[0],'page_pixels_limit');
});

test('live catalog rendering includes all accepted pages and can continue after local filters hide everything',()=>{
  const block=html.slice(html.indexOf('function catalogResults('),html.indexOf('function V2CategoryHeader('));
  const render=new Function('V2ChoiceResults','catalogPage','currentRoute','ui','filterParams','V2CatalogChoices','tx','esc','formatUSD','DEVELOPER_MODE','button','icon','liveLoadMoreMarkup','productCard','Catalog','catalogPaginationMarkup','emptyMarkup','filterChips','liveContextNotice',block+';return catalogResults;')(
    p=>p,p=>({page:1,start:1,end:24,total:p.length,items:p.slice(0,24)}),()=>({name:'shop'}),{page:1,sort:'featured'},()=>new URLSearchParams(),()=>({}),(_ar,en)=>en,String,String,false,
    (_label,attributes)=>'<button '+attributes+'></button>',()=>'',()=>'<button data-live-load-more></button>',p=>'<article data-id="'+p.id+'"></article>',{usingLive:()=>true},()=>'',()=>'<p>Empty</p>',()=>'',()=>''
  );
  const markup=render(Array.from({length:50},(_,i)=>({id:'item'+i})));
  assert.equal((markup.match(/<article /g)||[]).length,50);
  assert.ok(markup.includes('item49'));
  assert.ok(render([]).includes('data-live-load-more'));
});
