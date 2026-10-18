const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function adapter(fetch) {
  const context = {module:{exports:{}},URL,URLSearchParams,AbortController,TextDecoder,setTimeout,clearTimeout,fetch};
  vm.runInNewContext(fs.readFileSync(require.resolve('../catalog-live.js'),'utf8'),context);
  return context.module.exports;
}
const domains=['nike.com','adidas.com','levi.com','elfcosmetics.com','sephora.com','tjmaxx.tjx.com'];
const terms=['Nike','adidas',"Levi's",'e.l.f. cosmetics','Sephora','TJ Maxx'];
const item=(id,domain='nike.com')=>({id,title:id,brands:[{name:'Jordan'}],images:[],offers:[{domain,url:'https://buy.trychannel3.com/item'}]});
const envelope=(products,next=null,patch={})=>({provider:'channel3',data:{products,next_page_token:next},fetchedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+240000).toISOString(),...patch});
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const cjItem=(index)=>({productId:'cj-'+index,title:'Nike shoe '+index,advertiserName:'NIKE',brand:'Nike',productUrl:'https://www.nike.com/t/shoe-'+index,imageUrl:'https://static.nike.com/shoe.jpg',sourceIndex:index});
const cjEnvelope=(products,rawCount,nextOffset,totalCount=100)=>({source:'CJ',advertiser:'NIKE',products,rawCount,nextOffset,totalCount});

test('leaf clothing category is not misclassified by Apparel and Accessories ancestor',()=>{
 const raw=item('jeans');raw.category={title:'Jeans',path:[{title:'Apparel & Accessories'},{title:'Clothing'},{title:'Pants'},{title:'Jeans'}]};
 assert.equal(adapter().normalizeChannel3Product(raw).category,'Fashion');
 raw.category={title:'Sneakers',path:[{title:'Apparel & Accessories'},{title:'Shoes'},{title:'Sneakers'}]};
 assert.equal(adapter().normalizeChannel3Product(raw).category,'Shoes');
});

test('official merchant evidence accepts its genuine sub-brands without inventing images',()=>{
  const api=adapter();
  const page=api.parseChannel3Page(envelope([item('jordan'),item('phishing','nike.com.evil.test')]));
  assert.deepEqual(Array.from(page.items,p=>p.id),['jordan']);
  assert.equal(page.items[0].brand,'Nike');
  assert.equal(page.items[0].media.length,0);
  assert.equal(page.invalidCount,1);
});

test('website filters are exact, source-specific and forwarded for featured discovery',async()=>{
  const calls=[],api=adapter(async url=>{
    const u=new URL(url),i=terms.indexOf(u.searchParams.get('q'));
    assert.ok(i>=0,'no unrelated fallback');
    calls.push(JSON.parse(u.searchParams.get('filters')));
    return response(envelope(Array.from({length:4},(_,n)=>item('p'+i+'-'+n,domains[i]))));
  });
  const page=await api.fetchChannel3Page({section:'featured'});
  assert.equal(page.items.length,24);
  assert.deepEqual(calls,domains.map(domain=>({website_ids:[domain]})));
  const url=new URL(api.buildChannel3Url({q:'lipstick',filters:{website_ids:['sephora.com']}}));
  assert.deepEqual(JSON.parse(url.searchParams.get('filters')),{website_ids:['sephora.com']});
  for(const website_ids of [['nike.com.evil'],['nike.com','adidas.com'],['https://nike.com'],['www.nike.com']])assert.throws(()=>api.buildChannel3Url({q:'x',filters:{website_ids}}),/catalog_options/);
});

test('requested retailer is checked after transport and duplicate records are reported',()=>{
  const api=adapter(),page=api.parseChannel3Page(envelope([item('a'),item('a'),item('b','adidas.com')]),{q:'shoe',filters:{website_ids:['nike.com']}});
  assert.deepEqual(Array.from(page.items,p=>p.id),['a']);
  assert.equal(page.invalidCount,2);
  assert.equal(page.diagnostics.rejectionReasons.duplicate_product,1);
  assert.equal(page.diagnostics.rejectionReasons.retailer_mismatch,1);
});

test('generated sections scope transport and response validation to their official retailer',()=>{
 const api=adapter(),sections={men:'levi.com',women:'nike.com',shoes:'adidas.com',clothing:'levi.com',beauty:'elfcosmetics.com',accessories:'nike.com',sports:'nike.com',brands:'sephora.com'};
 for(const [section,domain] of Object.entries(sections)){
  const url=new URL(api.buildChannel3Url({section}));
  assert.deepEqual(JSON.parse(url.searchParams.get('filters')),{website_ids:[domain]},section);
  const page=api.parseChannel3Page(envelope([item('expected',domain),item('other',domain==='nike.com'?'adidas.com':'nike.com')]),{section});
  assert.deepEqual(Array.from(page.items,p=>p.id),['expected'],section);
  assert.equal(page.diagnostics.rejectionReasons.retailer_mismatch,1);
 }
});

test('exact retailer query uses the same scope for transport and parsing without narrowing generic searches',()=>{
 const api=adapter(),shared={...item('shared'),offers:undefined,sellerDomains:['nike.com','sephora.com']};
 const page=api.parseChannel3Page(envelope([shared,item('wrong')]),{q:'Sephora'});
 assert.equal(page.items.length,1);assert.equal(page.items[0].brand,'Sephora');
 const url=new URL(api.buildChannel3Url({q:'running shoes'}));
 assert.equal(url.searchParams.has('filters'),false);
 assert.equal(api.parseChannel3Page(envelope([item('nike'),item('adidas','adidas.com')]),{q:'running shoes'}).items.length,2);
 const explicit=api.parseChannel3Page(envelope([shared]),{q:'Sephora',filters:{website_ids:['nike.com']}});
 assert.equal(explicit.items[0].brand,'Nike');
});

test('mixed duplicate merchant listings do not consume display slots or skip unused unique records',async()=>{
 const calls=[],api=adapter(async url=>{
  const i=terms.indexOf(new URL(url).searchParams.get('q'));
  assert.ok(i>=0,'no fallback needed for these complete official pages');calls.push(i);
  return response(envelope(Array.from({length:24},(_,n)=>item(n<2?'shared-'+n:'unique-'+i+'-'+n,domains[i]))));
 });
 const seen=[];let cursor=null,pages=0;
 do{
  const page=await api.fetchChannel3Page({section:'featured',cursor});
  assert.equal(new Set(page.items.map(p=>p.id)).size,page.items.length,'one display slot per product');
  if(pages===0)assert.equal(page.items.length,24,'fill the page from remaining unique cards');
  seen.push(...page.items.map(p=>p.id));cursor=page.nextCursor;pages++;
  assert.ok(pages<=6,'bounded complete traversal');
 }while(cursor);
 assert.equal(seen.length,134);assert.equal(new Set(seen).size,134);
 assert.equal(calls.length,6,'reuse validated source pages without additional requests');
});

test('all approved merchant aliases survive cached seller identity without crowding out later retailers',()=>{
 const raw={...item('shared'),offers:undefined,sellerDomains:['nike.com','www.nike.com','adidas.com','www.adidas.com','levi.com','www.levi.com','sephora.com']};
 const page=adapter().parseChannel3Page(envelope([raw]),{q:'makeup',filters:{website_ids:['sephora.com']}});
 assert.equal(page.items.length,1);assert.equal(page.items[0].brand,'Sephora');
});

test('a rate-limited source does not prevent a different cached source request',async()=>{
  const calls=[],api=adapter(async url=>{
    calls.push(url);
    return calls.length===1?new Response('{}',{status:429,headers:{'retry-after':'60'}}):response(envelope([item('ok','adidas.com')]));
  });
  await assert.rejects(api.fetchChannel3Page({q:'sephora'}),/catalog_rate_limited/);
  const page=await api.fetchChannel3Page({q:'adidas'});
  assert.equal(page.items.length,1);assert.equal(calls.length,2);
});

test('explicit presentation fallback permits only bounded sanitized browsing and reports degradation',()=>{
  const api=adapter(),old=Date.now()-600000;
  const payload=envelope([item('cached')],'untrusted-stale-cursor',{status:'presentation_only',error:'CATALOG_REFRESH_UNAVAILABLE',fetchedAt:new Date(old).toISOString(),expiresAt:new Date(old+3600000).toISOString()});
  const page=api.parseChannel3Page(payload,{q:'shoe'});
  assert.equal(page.items.length,1);assert.equal(page.nextCursor,null);assert.equal(page.degraded,true);
  assert.equal(page.items[0].priceCents,null);assert.equal(page.items[0].source.merchantUrl,null);
  assert.throws(()=>api.parseChannel3Page({...payload,status:'fresh'},{q:'shoe'}),/catalog_payload/);
  assert.throws(()=>api.parseChannel3Page({...payload,expiresAt:new Date(old+3600001).toISOString()},{q:'shoe'}),/catalog_payload/);
});

test('transport distinguishes spending limits, rate limits, cursor expiry and provider failure',async()=>{
 for(const [status,upstream,expected] of [[429,'UPSTREAM_BUDGET_EXCEEDED','catalog_budget_exhausted'],[429,'UPSTREAM_RATE_LIMITED','catalog_rate_limited'],[503,'UPSTREAM_BUDGET_UNAVAILABLE','catalog_budget_unavailable'],[502,'UPSTREAM_UNAVAILABLE','catalog_provider_unavailable'],[410,'CURSOR_EXPIRED','catalog_cursor_expired']]){
  const api=adapter(async()=>new Response(JSON.stringify({error:upstream}),{status,headers:{'content-type':'application/json'}}));
  await assert.rejects(api.fetchChannel3Page({q:'lipstick',cursor:status===410?'old':null}),{code:expected});
 }
});

test('mixed catalog retains per-retailer rejection and cached presentation diagnostics',async()=>{
 const api=adapter(async url=>{
  const i=terms.indexOf(new URL(url).searchParams.get('q'));
  if(i<0)throw Error('No fallback');
  if(i===0)return new Response(JSON.stringify({error:'UPSTREAM_BUDGET_EXCEEDED'}),{status:429,headers:{'content-type':'application/json'}});
  const patch=i===1?{status:'presentation_only',error:'CATALOG_REFRESH_UNAVAILABLE'}:{};
  return response(envelope([...Array.from({length:4},(_,n)=>item('p'+i+'-'+n,domains[i])),item('bad','evil.test')],null,patch));
 });
 const page=await api.fetchChannel3Page({section:'featured'});
 assert.equal(page.items.length,20);assert.equal(page.invalidCount,5);assert.equal(page.partialErrors,1);assert.equal(page.degraded,true);
 assert.equal(page.sourceDiagnostics.find(s=>s.retailer==='Nike').error,'catalog_budget_exhausted');
 assert.equal(page.sourceDiagnostics.find(s=>s.retailer==='Adidas').status,'presentation_only');
});

test('CJ pagination advances by examined source rows and retains their original positions',()=>{
 const api=adapter(),page=api.parseCjNikePreviewPage(cjEnvelope([cjItem(21),cjItem(23)],4,24),{limit:4,offset:20});
 assert.equal(page.nextOffset,24);assert.equal(page.invalidCount,2);assert.equal(page.rawCount,4);
 assert.deepEqual(Array.from(page.items,p=>p.sourceIndex),[21,23]);
 const empty=api.parseCjNikePreviewPage(cjEnvelope([],4,24),{limit:4,offset:20});
 assert.equal(empty.items.length,0);assert.equal(empty.nextOffset,24);assert.equal(empty.invalidCount,4);
 const legacy=api.parseCjNikePreviewPage({source:'CJ',advertiser:'NIKE',products:[cjItem(99)],totalCount:100},{limit:4,offset:20});
 assert.equal(legacy.nextOffset,21);assert.equal(legacy.items[0].sourceIndex,20);
});

test('CJ explicit pagination metadata rejects incoherent or nonprogressing source positions',()=>{
 const api=adapter(),valid=cjEnvelope([cjItem(21),cjItem(23)],4,24);
 for(const patch of [{rawCount:5},{rawCount:-1},{rawCount:1},{nextOffset:20},{nextOffset:23},{nextOffset:25},{nextOffset:101},{rawCount:undefined},{nextOffset:undefined},
   {products:[cjItem(23),cjItem(21)]},{products:[cjItem(21),cjItem(21)]},{products:[cjItem(19)]},{products:[cjItem(24)]},{products:[{...cjItem(21),sourceIndex:undefined}]}]){
  assert.throws(()=>api.parseCjNikePreviewPage({...valid,...patch},{limit:4,offset:20}),/catalog_payload/);
 }
 assert.throws(()=>api.parseCjNikePreviewPage(cjEnvelope([],0,20),{limit:4,offset:20}),/catalog_payload/);
 assert.throws(()=>api.parseCjNikePreviewPage(cjEnvelope([cjItem(4999)],4,5002,6000),{limit:4,offset:4998}),/catalog_payload/);
 assert.equal(api.parseCjNikePreviewPage(cjEnvelope([cjItem(4999)],4,null,6000),{limit:4,offset:4998}).nextOffset,null);
});

test('a CJ shelf with no accepted rows retains its progressing continuation',async()=>{
 const offsets=[],api=adapter(async url=>{
  const u=new URL(url);
  if(u.pathname==='/catalog/search')return new Response('{"error":"UPSTREAM_UNAVAILABLE"}',{status:502,headers:{'content-type':'application/json'}});
  const offset=Number(u.searchParams.get('offset'));offsets.push(offset);
  return response(offset===0?cjEnvelope([],24,24,25):cjEnvelope([cjItem(24)],1,null,25));
 });
 const first=await api.fetchChannel3Page({q:'Nike'});
 assert.equal(first.items.length,0);assert.equal(first.nextCursor,'cj:24');assert.equal(first.invalidCount,24);
 const next=await api.fetchChannel3Page({q:'Nike',cursor:first.nextCursor});
 assert.deepEqual(Array.from(next.items,p=>p.id),['cj-nike-cj-24']);assert.equal(next.nextCursor,null);
 assert.deepEqual(offsets,[0,24]);
});

test('mixed partial CJ consumption resumes after the original source slot without skipping its remaining item',async()=>{
 const offsets=[],api=adapter(async url=>{
  const u=new URL(url);
  if(u.pathname==='/catalog/search')return response(envelope(u.searchParams.get('q')==='Nike'?[item('channel3-nike')]:[]));
  const offset=Number(u.searchParams.get('offset'));offsets.push(offset);
  return response(offset===0?cjEnvelope([cjItem(5),cjItem(9)],10,null,10):cjEnvelope([cjItem(9)],4,null,10));
 });
 const first=await api.fetchChannel3Page({section:'featured',limit:2});
 assert.equal(first.items.length,2);assert.equal(JSON.parse(first.nextCursor).j,6);
 const next=await api.fetchChannel3Page({section:'featured',limit:2,cursor:first.nextCursor});
 assert.deepEqual(Array.from(next.items,p=>p.id),['cj-nike-cj-9']);assert.equal(next.nextCursor,null);
 assert.deepEqual(offsets,[0,6]);
});
