'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../backend/commerce/index.js');
const { MemoryStore, FIXED_NOW, requestBody, freshProduct, event, config } = require('./helpers/commerce.cjs');
function setup() {
  const store = new MemoryStore(); let calls = 0;
  const handler = createHandler({ store, catalog: { freshProduct: async input => { calls++; return freshProduct(input); } }, config, now: () => FIXED_NOW, logger: { error() {} } });
  return { store, handler, calls: () => calls };
}
const json = response => JSON.parse(response.body);
async function quoted(handler) {
  const { quote } = json(await handler(event('POST', '/commerce/quotes', requestBody())));
  return { quoteId: quote.quoteId, cartRevision: quote.cartRevision, cartHash: quote.cartHash };
}
test('fee trigger is explicitly unresolved and non-payment requests are available independently of checkout', async () => {
  const { handler } = setup(); const capabilities = json(await handler(event('GET', '/commerce/capabilities')));
  assert.equal(capabilities.serviceFee.appliesOn, 'owner_decision_pending');
  assert.equal(capabilities.serviceFee.collectionEnabled, false);
  assert.deepEqual(capabilities.serviceRequests, { create: true, read: true, paymentRequired: false });
  const quote = json(await handler(event('POST', '/commerce/quotes', requestBody()))).quote;
  assert.match(quote.costs.components.find(c => c.code === 'anox_service_fee').note, /qualifying order/i);
  assert.doesNotMatch(quote.costs.components.find(c => c.code === 'anox_service_fee').note, /successfully completed/);
});
test('a service request records product references and honest Algeria costs without provider calls or financial authority', async () => {
  const { handler, store, calls } = setup(), input = await quoted(handler), before = calls();
  const response = await handler(event('POST', '/commerce/service-requests', input));
  assert.equal(response.statusCode, 201, response.body);
  const value = json(response).serviceRequest;
  assert.equal(value.kind, 'service_request'); assert.equal(value.status, 'received');
  assert.equal(value.destination.country, 'DZ'); assert.equal(value.lines[0].productId, 'product1');
  assert.equal(value.lines[0].quantity, 2); assert.equal(value.lines[0].unitPriceMinor, 1999);
  assert.equal(value.totalMinor, null); assert.equal(value.costs.verifiedPayableTotalMinor, null);
  assert.equal(value.costs.estimatedTotalMinor, null); assert.equal(value.payment.status, 'not_requested');
  assert.equal(value.fulfillment.status, 'not_requested'); assert.deepEqual(value.fulfillment.tracking, []);
  assert.equal(value.merchantOrderReference, null); assert.equal(value.serviceFee.amountMinor, 500);
  assert.equal(value.serviceFee.collectionEnabled, false); assert.equal(calls(), before);
  assert.ok(value.costs.components.filter(c => /shipping|customs|tax/.test(c.code)).every(c => c.status === 'unknown' && c.amountMinor === null));
  assert.equal((await store.get('customer-a', 'order', value.orderId)).kind, 'service_request');
  assert.equal(store.audits.at(-1).type, 'service_request.received');
  assert.equal(json(await handler(event('GET', '/commerce/orders'))).orders[0].orderId, value.orderId);
  assert.deepEqual(json(await handler(event('GET', '/commerce/orders/' + value.orderId))).order, value);
});
test('service request retries coalesce, bind cart and customer, and never create duplicate records', async () => {
  const { handler, store } = setup(), input = await quoted(handler);
  const first = await handler(event('POST', '/commerce/service-requests', input));
  assert.equal(first.statusCode, 201, first.body);
  const replay = await handler(event('POST', '/commerce/service-requests', input));
  assert.equal(replay.body, first.body); assert.equal(replay.headers['Idempotency-Replayed'], 'true');
  const conflict = await handler(event('POST', '/commerce/service-requests', { ...input, cartHash: 'a'.repeat(64) }));
  assert.equal(conflict.statusCode, 409); assert.equal(json(conflict).error.code, 'idempotency_conflict');
  const other = event('POST', '/commerce/service-requests', input); other.requestContext.authorizer.jwt.claims.sub = 'customer-b';
  assert.equal((await handler(other)).statusCode, 404);
  const id = json(first).serviceRequest.orderId;
  const read = event('GET', '/commerce/orders/' + id); read.requestContext.authorizer.jwt.claims.sub = 'customer-b';
  assert.equal((await handler(read)).statusCode, 404);
  assert.equal((await handler(event('POST', '/commerce/orders/' + id + '/cancel', {}))).statusCode, 409);
  assert.equal([...store.records.keys()].filter(k => JSON.parse(k)[1] === 'order').length, 1);
});
test('service requests reject stale quotes, client financial claims and unauthenticated access', async () => {
  const { handler, store } = setup(), input = await quoted(handler);
  for (const field of ['paid', 'price', 'totalMinor', 'customerId', 'merchantOrderReference', 'status']) {
    assert.equal((await handler(event('POST', '/commerce/service-requests', { ...input, [field]: 'untrusted' }))).statusCode, 400);
  }
  const missing = event('POST', '/commerce/service-requests', input); delete missing.requestContext.authorizer;
  assert.equal((await handler(missing)).statusCode, 401);
  const stale = createHandler({ store, catalog: { freshProduct }, config, now: () => FIXED_NOW + 60000, logger: { error() {} } });
  const response = await stale(event('POST', '/commerce/service-requests', input));
  assert.equal(response.statusCode, 409); assert.equal(json(response).error.code, 'quote_expired');
  assert.equal([...store.records.keys()].filter(k => JSON.parse(k)[1] === 'order').length, 0);
});
test('only approved retailer hosts can reach commerce hydration', async () => {
  const { handler, calls } = setup();
  for (const merchantDomain of ['merchant.example', 'nike.com.evil.example', 'amazon.com']) {
    const body = requestBody(); body.lines[0].merchantDomain = merchantDomain;
    const response = await handler(event('POST', '/commerce/quotes', body));
    assert.equal(response.statusCode, 422); assert.equal(json(response).error.code, 'unsupported_merchant');
  }
  assert.equal(calls(), 0);
});
test('a reviewed quote can create only one service record across distinct retries and parallel tabs', async () => {
 const {handler,store}=setup(),input=await quoted(handler);
 const attempt=key=>{const e=event('POST','/commerce/service-requests',input);e.headers['idempotency-key']=key;return handler(e);};
 const results=await Promise.all([attempt('tab-one-request-001'),attempt('tab-two-request-001')]);
 assert.ok(results.every(r=>r.statusCode===201||r.statusCode===409));
 const first=results.find(r=>r.statusCode===201);assert.ok(first);
 const replay=await attempt('tab-two-request-001');assert.equal(replay.statusCode,201,replay.body);
 assert.equal(json(replay).serviceRequest.orderId,json(first).serviceRequest.orderId);
 assert.equal([...store.records.keys()].filter(k=>JSON.parse(k)[1]==='order').length,1);
 assert.equal(store.audits.filter(a=>a.type==='service_request.received').length,1);
});

test('official aliases accepted by catalog remain usable as the same six retailer offers', async () => {
 const hosts=['nike.com','www.nike.com','adidas.com','www.adidas.com','sephora.com','www.sephora.com','levi.com','www.levi.com','elfcosmetics.com','www.elfcosmetics.com','tjmaxx.tjx.com','www.tjmaxx.tjx.com','tjmaxx.com','www.tjmaxx.com'];
 for(const merchantDomain of hosts){
  const body=requestBody();body.lines[0].merchantDomain=merchantDomain;
  const handler=createHandler({store:new MemoryStore(),catalog:{freshProduct:async input=>{const p=freshProduct(input);p.data.product.offers[0].domain=merchantDomain;return p;}},config,now:()=>FIXED_NOW,logger:{error(){}}});
  const response=await handler(event('POST','/commerce/quotes',body));
  assert.equal(response.statusCode,201,merchantDomain+': '+response.body);
  assert.equal(json(response).quote.lines[0].merchantDomain,merchantDomain);
 }
});
test('durable service history never retains live offer URLs, commissions or stock claims', async () => {
 const {handler,store}=setup(),input=await quoted(handler);
 const created=await handler(event('POST','/commerce/service-requests',input));
 assert.equal(created.statusCode,201);
 const request=json(created).serviceRequest,record=await store.get('customer-a','order',request.orderId);
 for(const value of [record,request]){
  assert.equal(value.lines[0].offer.url,null);assert.equal(value.lines[0].offer.maxCommissionRate,null);
  assert.equal(value.lines[0].availability,'unknown');assert.equal(value.lines[0].priceStatus,'historical_estimate');
  assert.equal(value.lines[0].capturedAt,value.lines[0].validatedAt);assert.equal(value.lines[0].unitPriceMinor,1999);
  assert.match(value.costs.components.find(c=>c.code==='products').note,/historical/i);
  assert.doesNotMatch(JSON.stringify(value),/buy\.trychannel3\.com|InStock|maxCommissionRate":0\.03/);
 }
 const later=createHandler({store,catalog:{freshProduct:async()=>{throw Error('No history refresh authorized');}},config,now:()=>FIXED_NOW+86400000,logger:{error(){}}});
 const history=json(await later(event('GET','/commerce/orders/'+request.orderId,{},{requestContext:{http:{method:'GET'},authorizer:{jwt:{claims:{sub:'customer-a',iss:config.issuer,aud:config.clientId,token_use:'id',exp:String(FIXED_NOW/1000+172800)}}}}}))).order;
 assert.equal(history.lines[0].offer.url,null);assert.equal(history.lines[0].availability,'unknown');
});
test('public reads sanitize older service records that still contain volatile fields', async () => {
 const {handler,store}=setup(),input=await quoted(handler);
 const created=json(await handler(event('POST','/commerce/service-requests',input))).serviceRequest;
 const record=await store.get('customer-a','order',created.orderId);
 record.lines[0].offer.url='https://buy.trychannel3.com/old';record.lines[0].offer.maxCommissionRate=0.03;record.lines[0].availability='InStock';delete record.lines[0].priceStatus;delete record.lines[0].capturedAt;
 store.seed('customer-a','order',created.orderId,record);
 const read=await handler(event('GET','/commerce/orders/'+created.orderId));
 assert.equal(read.statusCode,200);const line=json(read).order.lines[0];
 assert.equal(line.offer.url,null);assert.equal(line.offer.maxCommissionRate,null);assert.equal(line.availability,'unknown');assert.equal(line.priceStatus,'historical_estimate');
});
test('replaying an older completed service operation cannot re-expose cached live offers', async () => {
 const {handler,store}=setup(),input=await quoted(handler);
 await handler(event('POST','/commerce/service-requests',input));
 const operation=store.operations.get(store.operationKey('customer-a','service_request','operation-key-000001'));
 const line=operation.result.serviceRequest.lines[0];line.offer.url='https://buy.trychannel3.com/stale';line.offer.maxCommissionRate=0.03;line.availability='InStock';delete line.priceStatus;delete line.capturedAt;
 const response=await handler(event('POST','/commerce/service-requests',input));
 assert.equal(response.statusCode,201);assert.equal(response.headers['Idempotency-Replayed'],'true');
 assert.equal(json(response).serviceRequest.lines[0].offer.url,null);assert.equal(json(response).serviceRequest.lines[0].priceStatus,'historical_estimate');
});
