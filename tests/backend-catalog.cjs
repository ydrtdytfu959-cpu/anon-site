'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHandler, createUpstream, createDynamoStore} = require('../backend');

// Only external persistence and provider I/O are replaced. The real request,
// sanitization, cursor, cache and response paths execute in every case.
function setup(source) {
  let time = 1_800_000_000_000;
  const rows = new Map(), leases = new Map(), calls = [];
  const store = {
    async get(key) {return structuredClone(rows.get(key));},
    async acquire(key, owner, now, until) {
      if (leases.get(key)?.until > now) return false;
      leases.set(key, {owner, until}); return true;
    },
    async publish(key, owner, value, cursor, now, extra = []) {
      assert.equal(leases.get(key)?.owner, owner);
      assert.ok(leases.get(key).until > now);
      rows.set(key, structuredClone(value));
      if (cursor) rows.set(cursor.key, structuredClone(cursor.value));
      for (const row of extra) rows.set(row.key, structuredClone(row.value));
      leases.delete(key);
    },
    async release(key, owner) {if (leases.get(key)?.owner === owner) leases.delete(key);}
  };
  const handler = createHandler({store, now:() => time, upstream:async input => {
    calls.push(structuredClone(input)); return source(input, calls.length);
  }});
  return {rows, calls, advance:ms => {time += ms;}, async page(params = {}) {
    const response = await handler({requestContext:{http:{method:'GET'}}, rawPath:'/catalog/search',
      rawQueryString:new URLSearchParams({q:'shoes', ...params}).toString()});
    return {httpStatus:response.statusCode, status:response.statusCode, ...JSON.parse(response.body)};
  }};
}
const item = (id, domain = 'nike.com', patch = {}) => ({id, title:'Product ' + id,
  brands:[{id:'brand', name:'Jordan'}], images:[{url:'https://cdn.trychannel3.com/' + id + '.jpg'}],
  offers:[{domain, url:'https://buy.trychannel3.com/' + id}], ...patch});

test('cards recover a safe regular image when cleaned image or leading image is invalid', async () => {
  const f = setup(() => ({products:[
    item('cleaned', 'nike.com', {images:[{url:'https://cdn.trychannel3.com/regular.jpg', cleaned_url:'https://untrusted.example/cleaned.jpg'}]}),
    item('later', 'adidas.com', {images:[{url:'https://untrusted.example/first.jpg'}, {url:'https://cdn.trychannel3.com/later.jpg'}]}),
    item('main', 'sephora.com', {images:[{url:'https://cdn.trychannel3.com/side.jpg'}, {url:'https://cdn.trychannel3.com/main.jpg', is_main_image:true}]})
  ], next_page_token:null}));
  const result = await f.page();
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.products.map(p => p.images[0]?.url), [
    'https://cdn.trychannel3.com/regular.jpg', 'https://cdn.trychannel3.com/later.jpg', 'https://cdn.trychannel3.com/main.jpg'
  ]);
  assert.deepEqual((await f.page()).data, result.data, 'safe normalized page survives cache validation');
  assert.equal(f.calls.length, 1);
});

test('catalog reports reconciled acceptance and rejection counts for each official retailer', async () => {
  const f = setup(() => ({products:[
    item('nike'), item('adidas','adidas.com'), item('sephora','sephora.com'), item('levis','levi.com'),
    item('tjmaxx','tjmaxx.tjx.com'), item('elf','elfcosmetics.com'), item('nike'),
    item('resale','reseller.example'), item('spoof','nike.com', {offers:[{domain:'nike.com',url:'https://untrusted.example/redirect'}]}),
    {id:'bad id',title:'Invalid'}
  ], next_page_token:null}));
  const result = await f.page();
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.products.map(p => p.id), ['nike','adidas','sephora','levis','tjmaxx','elf']);
  assert.deepEqual(result.data.diagnostics, {
    received:10, accepted:6, rejected:4,
    rejectionReasons:{invalid_product:1, unverified_merchant:2, retailer_mismatch:0, duplicate_product:1, traversal_limit:0},
    retailers:{Nike:1, Adidas:1, Sephora:1, "Levi's":1, 'TJ Maxx':1, 'e.l.f. Cosmetics':1},
    warnings:{missing_image:0}, pagination:{stopReason:null}
  });
  assert.deepEqual((await f.page()).data.diagnostics, result.data.diagnostics);
});

test('retailer scoping rejects a wrong official merchant without rejecting genuine missing-brand or image records', async () => {
  const f = setup(() => ({products:[item('jordan','nike.com',{brands:[],images:[]}), item('wrong','adidas.com')],next_page_token:null}));
  const result = await f.page({filters:JSON.stringify({website_ids:['nike.com']})});
  assert.deepEqual(result.data.products.map(p => p.id), ['jordan']);
  assert.deepEqual(result.data.products[0].sellerDomains, ['nike.com']);
  assert.equal(result.data.diagnostics.warnings.missing_image, 1);
  assert.equal(result.data.diagnostics.rejectionReasons.retailer_mismatch, 1);
});

test('overlapping source pages retain only unseen product identities and count duplicates', async () => {
  const f = setup(input => input.page_token
    ? {products:[item('a'),item('c')],next_page_token:null}
    : {products:[item('a'),item('b')],next_page_token:'page-2'});
  await f.page();
  const second = await f.page({page_token:'page-2'});
  assert.deepEqual(second.data.products.map(p => p.id), ['c']);
  assert.equal(second.data.diagnostics.rejectionReasons.duplicate_product, 1);
  assert.equal(second.data.diagnostics.received, 2);
  assert.deepEqual((await f.page({page_token:'page-2'})).data, second.data);
  assert.equal(f.calls.length, 2);
});

test('nonadjacent provider cursor cycle terminates while retaining the final valid products', async () => {
  const f = setup(input => ({products:[item(input.page_token || 'first')],
    next_page_token:input.page_token === 'a' ? 'b' : 'a'}));
  await f.page(); await f.page({page_token:'a'});
  const last = await f.page({page_token:'b'});
  assert.equal(last.status, 200);
  assert.deepEqual(last.data.products.map(p => p.id), ['b']);
  assert.equal(last.data.next_page_token, null);
  assert.equal(last.data.diagnostics.pagination.stopReason, 'cursor_cycle');
  assert.equal(f.calls.length, 3);
});

test('an empty provider page with a valid continuation does not hide a later available product', async () => {
  const f = setup(input => input.page_token
    ? {products:[item('recovered')],next_page_token:null}
    : {products:[],next_page_token:'after-empty'});
  const first = await f.page();
  assert.equal(first.status, 200);
  assert.equal(first.data.next_page_token, 'after-empty');
  const second = await f.page({page_token:'after-empty'});
  assert.equal(second.status, 200);
  assert.deepEqual(second.data.products.map(p => p.id), ['recovered']);
});

test('budget denial preserves bounded presentation cards without spending another HTTP request or extending timestamps', async () => {
  let denied = false, fetches = 0;
  const upstream = createUpstream({getSecret:async () => 'synthetic-key', reserve:async () => {
    if (denied) throw Object.assign(Error(), {code:'UPSTREAM_BUDGET_EXCEEDED'});
  }, fetch:async () => {
    fetches++;
    return new Response(JSON.stringify({products:[item('kept')],next_page_token:'next'}), {headers:{'content-type':'application/json'}});
  }});
  const f = setup(upstream), fresh = await f.page();
  denied = true; f.advance(300_000);
  const fallback = await f.page();
  assert.equal(fallback.httpStatus, 200);
  assert.equal(fallback.status, 'presentation_only');
  assert.equal(fallback.error, 'CATALOG_REFRESH_UNAVAILABLE');
  assert.equal(fallback.fetchedAt, fresh.fetchedAt);
  assert.equal(Date.parse(fallback.expiresAt) - Date.parse(fallback.fetchedAt), 3_600_000);
  assert.deepEqual(fallback.data.products, fresh.data.products);
  assert.equal(fallback.data.next_page_token, null);
  assert.equal(fetches, 1, 'a denied reservation never reaches provider HTTP');
  assert.ok(!JSON.stringify(fallback).includes('buy.trychannel3.com'));
  f.advance(3_299_999);
  assert.equal((await f.page()).status, 'presentation_only');
  f.advance(1);
  const expired = await f.page();
  assert.equal(expired.status, 429);
  assert.equal(expired.error, 'UPSTREAM_BUDGET_EXCEEDED');
  assert.equal(fetches, 1);
});

test('provider refresh failure retains cards only within the original one-hour presentation lifetime', async () => {
  const f = setup((input, count) => {
    if (count > 1) throw Error('private provider response');
    return {products:[item('still-visible')],next_page_token:null};
  });
  const fresh = await f.page(); f.advance(300_000);
  const fallback = await f.page();
  assert.equal(fallback.status, 'presentation_only');
  assert.equal(fallback.fetchedAt, fresh.fetchedAt);
  assert.equal(fallback.data.products[0].id, 'still-visible');
  assert.ok(!JSON.stringify(fallback).includes('private'));
});

test('presentation fallback cannot hide cache corruption or accept forged retailer diagnostics', async () => {
  for (const corrupt of [row => {row.payload.data.products[0].sellerDomains=['reseller.example'];},
    row => {row.payload.data.diagnostics.retailers.Nike=0;}, row => {row.retentionExpiresAtMs+=1;}]) {
    const f = setup(() => ({products:[item('verified')],next_page_token:null}));
    await f.page(); f.advance(300_000);
    corrupt([...f.rows.values()].find(row => row.kind === 'page'));
    const result = await f.page();
    assert.equal(result.status, 503);
    assert.equal(result.error, 'CACHE_UNAVAILABLE');
    assert.equal(f.calls.length, 1, 'corruption fails closed before another upstream request');
  }
});

test('Dynamo keeps only presentation cache rows for fallback while fresh expiry remains distinct', async () => {
  const calls=[], commands=Object.fromEntries(['GetItemCommand','PutItemCommand','DeleteItemCommand','TransactWriteItemsCommand']
    .map(name => [name,class {constructor(input){this.input=input;}}]));
  const store=createDynamoStore({table:'fixture', commands, client:{send:async command => {calls.push(command.input);return {};}}});
  await store.publish('page#one', 'owner', {kind:'page', expiresAtMs:301_000, retentionExpiresAtMs:3_601_000}, null, 1000);
  assert.equal(calls[0].TransactItems[0].Put.Item.expiresAt.N, '3601');
  await store.publish('detail#one', 'owner2', {kind:'detail', expiresAtMs:31_000}, null, 1000);
  assert.equal(calls[1].TransactItems[0].Put.Item.expiresAt.N, '31');
});

test('official domain aliases cannot crowd another approved retailer out of merchant verification', async () => {
  const domains=['nike.com','www.nike.com','adidas.com','www.adidas.com','sephora.com','www.sephora.com',
    'levi.com','www.levi.com','tjmaxx.tjx.com','www.tjmaxx.tjx.com','tjmaxx.com','www.tjmaxx.com',
    'elfcosmetics.com','www.elfcosmetics.com'];
  const f=setup(() => ({products:[item('all-stores','nike.com',{offers:domains.map((domain,i) =>
    ({domain,url:'https://buy.trychannel3.com/offer-'+i}))})], next_page_token:null}));
  const request={filters:JSON.stringify({website_ids:['elfcosmetics.com']})};
  const result=await f.page(request);
  assert.equal(result.data.products.length,1);
  assert.deepEqual(result.data.diagnostics.retailers,{Nike:1,Adidas:1,Sephora:1,"Levi's":1,'TJ Maxx':1,'e.l.f. Cosmetics':1});
  assert.deepEqual((await f.page(request)).data,result.data);
  assert.equal(f.calls.length,1);
});

test('the 500-source-record traversal cap applies before filtering the last source page', async () => {
  const f=setup((input,n) => ({products:Array.from({length:24},(_,i) => n===21 && i<10
    ? {id:'invalid id'} : item('p'+n+'_'+i)),next_page_token:'page-'+n}));
  let result=await f.page();
  for(let n=2;n<=21;n++)result=await f.page({page_token:result.data.next_page_token});
  assert.equal(result.data.products.length,10);
  assert.equal(result.data.diagnostics.received,24);
  assert.equal(result.data.diagnostics.rejectionReasons.invalid_product,10);
  assert.equal(result.data.diagnostics.rejectionReasons.traversal_limit,4);
  assert.equal(result.data.diagnostics.pagination.stopReason,'traversal_limit');
  assert.equal(result.data.next_page_token,null);
});

test('a reused provider token cannot replay a page deduplicated against an older first-page generation', async () => {
  const f=setup((input,n) => input.page_token
    ? {products:[item('a'),item('b')],next_page_token:null}
    : {products:[item(n===1?'a':'c')],next_page_token:'reused-token'});
  assert.deepEqual((await f.page()).data.products.map(p=>p.id),['a']);
  f.advance(240_000);
  assert.deepEqual((await f.page({page_token:'reused-token'})).data.products.map(p=>p.id),['b']);
  f.advance(120_000);
  assert.deepEqual((await f.page()).data.products.map(p=>p.id),['c']);
  const second=await f.page({page_token:'reused-token'});
  assert.deepEqual(second.data.products.map(p=>p.id),['a','b']);
  assert.equal(second.data.diagnostics.rejectionReasons.duplicate_product,0);
  assert.deepEqual((await f.page({page_token:'reused-token'})).data,second.data);
  assert.equal(f.calls.length,4,'a different traversal refreshes once and then reuses its own cached page');
});
