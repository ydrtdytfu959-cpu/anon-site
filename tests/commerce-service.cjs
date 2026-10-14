const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../backend/commerce/index.js');
const { MemoryStore, FIXED_NOW, requestBody, freshProduct, event, config } = require('./helpers/commerce.cjs');
function setup(overrides = {}) {
  const store = new MemoryStore(); let calls = 0;
  const handler = createHandler({ store, catalog: { freshProduct: async (input) => { calls++; return freshProduct(input); } }, config, now: () => FIXED_NOW, logger: { info() {}, error() {} }, ...overrides });
  return { store, handler, calls: () => calls };
}
const json = r => JSON.parse(r.body);
test('public capabilities truthfully gate purchasing and expose bounded quote limits', async () => {
  const { handler } = setup(); const result = await handler(event('GET', '/commerce/capabilities', undefined, { requestContext: { http: { method: 'GET' } } }));
  assert.equal(result.statusCode, 200); const body = json(result);
  assert.equal(body.checkout.enabled, false); assert.equal(body.serviceFee.amountMinor, 500); assert.equal(body.orders.cancel, false); assert.equal(body.quote.limits.maxDistinctProducts, 5);
});
test('fresh quote contains authoritative money and attribution, conditional fee, no fabricated landed total', async () => {
  const { handler, store, calls } = setup(); const response = await handler(event('POST', '/commerce/quotes', requestBody()));
  assert.equal(response.statusCode, 201); const { quote } = json(response);
  assert.equal(quote.lines[0].unitPriceMinor, 1999); assert.equal(quote.lines[0].lineTotalMinor, 3998);
  assert.equal(quote.lines[0].offer.url, 'https://buy.trychannel3.com/item?affiliate=preserved');
  assert.equal(quote.costs.components.find(x => x.code === 'anox_service_fee').amountMinor, 500);
  assert.equal(quote.costs.components.find(x => x.code === 'anox_service_fee').status, 'conditional');
  assert.equal(quote.costs.components.find(x => x.code === 'products').status, 'estimated');
  assert.equal(quote.costs.estimatedTotalMinor, null); assert.equal(quote.costs.verifiedPayableTotalMinor, null); assert.equal(quote.checkout.enabled, false);
  assert.ok(Date.parse(quote.expiresAt) <= FIXED_NOW + 60000); assert.equal(calls(), 1); assert.equal(store.audits.length, 1);
});
test('strict input rejects client prices, polluted keys, excessive lines and unsupported destinations before upstream reads', async () => {
  const { handler, calls } = setup(); const attempts = [];
  for (const field of ['price', 'unitPriceMinor', 'total', 'owner', 'customerId']) { const b = requestBody(); b.lines[0][field] = 1; attempts.push(b); }
  const destination = requestBody(); destination.destination.country = 'US'; attempts.push(destination);
  const lines = requestBody(); lines.lines = Array.from({ length: 11 }, () => structuredClone(lines.lines[0])); attempts.push(lines);
  const variant = requestBody(); variant.lines[0].options = JSON.parse('{"__proto__":"x"}'); attempts.push(variant);
  for (const body of attempts) assert.ok([400, 422].includes((await handler(event('POST', '/commerce/quotes', body))).statusCode));
  assert.equal(calls(), 0);
});
test('authentication rejects wrong/missing audience issuer expiry and subject without accessing customer state', async () => {
  const { handler, calls } = setup();
  for (const claims of [{}, { sub: 'customer-a' }, { sub: 'customer-a', iss: config.issuer, aud: 'other', exp: FIXED_NOW / 1000 + 100 }, { sub: 'customer-a', iss: config.issuer, aud: config.clientId, token_use: 'id', exp: FIXED_NOW / 1000 - 1 }]) {
    const e = event('POST', '/commerce/quotes', requestBody()); e.requestContext.authorizer.jwt.claims = claims;
    assert.equal((await handler(e)).statusCode, 401);
  } assert.equal(calls(), 0);
});
test('idempotent replay returns identical response and conflicting retries cannot call provider again', async () => {
  const { handler, calls } = setup(); const original = await handler(event('POST', '/commerce/quotes', requestBody()));
  const duplicate = await handler(event('POST', '/commerce/quotes', requestBody()));
  assert.equal(duplicate.body, original.body); assert.equal(duplicate.headers['Idempotency-Replayed'], 'true');
  const changed = requestBody(); changed.lines[0].quantity = 3;
  assert.equal((await handler(event('POST', '/commerce/quotes', changed))).statusCode, 409); assert.equal(calls(), 1);
});
test('atomic in-flight idempotency prevents duplicate upstream fanout', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; }); let calls = 0;
  const { handler } = setup({ catalog: { freshProduct: async x => { calls++; await waiting; return freshProduct(x); } } });
  const first = handler(event('POST', '/commerce/quotes', requestBody()));
  await new Promise(resolve => setImmediate(resolve));
  const second = await handler(event('POST', '/commerce/quotes', requestBody()));
  assert.equal(second.statusCode, 409); assert.equal(json(second).error.code, 'operation_in_progress');
  release(); assert.equal((await first).statusCode, 201); assert.equal(calls, 1);
});
test('merchant, condition, selection relaxation, currency and stale data fail closed', async () => {
  for (const mutate of [p => { p.data.product.id = 'wrong'; }, p => { p.selectionMismatch = [{ name: 'Size', requested: 'M', effective: 'L' }]; }, p => { p.data.product.variants.selected = [{ name: 'Size', label: 'L' }]; }, p => { p.data.product.offers[0].domain = 'other.example'; }, p => { p.data.product.offers[0].condition = 'used'; }, p => { p.data.product.offers[0].price.currency = 'EUR'; }, p => { p.expiresAt = new Date(FIXED_NOW - 1).toISOString(); }, p => { p.status = 'cached'; }]) {
    const { handler } = setup({ catalog: { freshProduct: async x => { const p = freshProduct(x); mutate(p); return p; } } });
    const response = await handler(event('POST', '/commerce/quotes', requestBody())); assert.ok([409, 422, 503].includes(response.statusCode), response.body);
  }
});
test('unknown/out-of-stock availability remains explicit and checkout blocked', async () => {
  for (const availability of [null, 'OutOfStock']) {
    const { handler } = setup({ catalog: { freshProduct: async x => { const p = freshProduct(x); p.data.product.offers[0].availability = availability; return p; } } });
    const result = await handler(event('POST', '/commerce/quotes', requestBody()));
    assert.equal(result.statusCode, 201); const quote = json(result).quote;
    assert.equal(quote.lines[0].availability, availability || 'unknown');
    assert.ok(quote.checkout.blockers.some(x => /availability/.test(x.code)));
  }
});
test('unselected required provider variants and ambiguously priced duplicate offers are rejected', async () => {
  for (const mutate of [p => { p.data.product.variants.options.push({ name: 'Color', values: [{ label: 'Red', exists: true }] }); }, p => { const other = structuredClone(p.data.product.offers[0]); other.price.price = 9.99; p.data.product.offers.push(other); }]) {
    const { handler } = setup({ catalog: { freshProduct: async x => { const p = freshProduct(x); mutate(p); return p; } } });
    assert.equal((await handler(event('POST', '/commerce/quotes', requestBody()))).statusCode, 422);
  }
});
test('fresh read deadline aborts, returns503, persists no partial quote and releases a retry lease', async () => {
  let aborted = false; const { handler, store } = setup({ hydrationTimeoutMs: 15, catalog: { freshProduct: async (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); })) } });
  const result = await handler(event('POST', '/commerce/quotes', requestBody()));
  assert.equal(result.statusCode, 503); assert.equal(aborted, true); assert.equal(store.records.size, 0);
  assert.equal([...store.operations.values()][0].leaseUntil, 0);
});
test('duplicate product/options share read and distinct fresh calls never exceed three', async () => {
  let active = 0, maximum = 0, calls = 0;
  const { handler } = setup({ catalog: { freshProduct: async x => { calls++; maximum = Math.max(maximum, ++active); await new Promise(resolve => setTimeout(resolve, 5)); active--; const p = freshProduct(x); p.data.product.offers.push({ ...structuredClone(p.data.product.offers[0]), domain: 'other.example', url: 'https://other.example/item' }); return p; } } });
  const body = requestBody(); body.lines = Array.from({ length: 5 }, (_, i) => ({ ...structuredClone(body.lines[0]), productId: 'product' + i }));
  body.lines.push({ ...structuredClone(body.lines[0]), merchantDomain: 'other.example' });
  assert.equal((await handler(event('POST', '/commerce/quotes', body))).statusCode, 201); assert.equal(calls, 5); assert.equal(maximum, 3);
});
test('blocked checkout attempt requires quote owner/cart/expiry and never writes an order', async () => {
  const { handler, store } = setup(); const quote = json(await handler(event('POST', '/commerce/quotes', requestBody()))).quote;
  const body = { quoteId: quote.quoteId, cartRevision: quote.cartRevision, cartHash: quote.cartHash };
  const other = event('POST', '/commerce/checkout-attempts', body); other.requestContext.authorizer.jwt.claims.sub = 'customer-b';
  assert.equal((await handler(other)).statusCode, 404);
  assert.equal((await handler(event('POST', '/commerce/checkout-attempts', { ...body, cartHash: 'a'.repeat(64) }))).statusCode, 409);
  const validAttempt = event('POST', '/commerce/checkout-attempts', body); validAttempt.headers['idempotency-key'] = 'operation-key-correct-001';
  const result = await handler(validAttempt); assert.equal(result.statusCode, 201);
  assert.equal(json(result).attempt.status, 'blocked'); assert.equal(json(result).attempt.checkout.enabled, false);
  assert.equal([...store.records.keys()].filter(k => JSON.parse(k)[1] === 'order').length, 0);
  const expired = createHandler({ store, catalog: { freshProduct }, config, now: () => FIXED_NOW + 60000, logger: { info() {}, error() {} } });
  const e = event('POST', '/commerce/checkout-attempts', body); e.headers['idempotency-key'] = 'operation-key-later-0001';
  assert.equal((await expired(e)).statusCode, 409);
});
test('order reads enforce ownership and disabled actions never alter state', async () => {
  const { handler, store } = setup(); store.seed('customer-a', 'order', 'order_123456', { orderId: 'order_123456', version: 1, status: 'confirmed', currency: 'USD', totalMinor: 3998, createdAt: new Date(FIXED_NOW).toISOString(), payment: { status: 'succeeded', amountMinor: 3998 }, fulfillment: { status: 'unfulfilled' }, privateSecret: 'must-not-leak' });
  const result = await handler(event('GET', '/commerce/orders/order_123456')); assert.equal(result.statusCode, 200); assert.doesNotMatch(result.body, /must-not-leak|privateSecret/);
  const other = event('GET', '/commerce/orders/order_123456'); other.requestContext.authorizer.jwt.claims.sub = 'customer-b'; assert.equal((await handler(other)).statusCode, 404);
  assert.equal((await handler(event('POST', '/commerce/orders/order_123456/cancel', {}))).statusCode, 409);
  assert.equal((await store.get('customer-a', 'order', 'order_123456')).status, 'confirmed');
  const list = await handler(event('GET', '/commerce/orders')); assert.equal(json(list).orders.length, 1); assert.equal(json(list).orders[0].capabilities.cancel, false);
});
test('webhooks are disabled independent of supplied payload/config and CORS rejects foreign origins', async () => {
  const { handler } = setup({ config: { ...config, checkoutEnabled: true, stripeEnabled: true } });
  assert.equal((await handler(event('POST', '/commerce/webhooks/stripe', { type: 'payment_intent.succeeded' }))).statusCode, 409);
  const e = event('GET', '/commerce/capabilities'); e.headers.origin = 'https://evil.example'; const r = await handler(e); assert.equal(r.statusCode, 403); assert.equal(r.headers['Access-Control-Allow-Origin'], undefined);
  const preflight = await handler(event('OPTIONS', '/commerce/quotes')); assert.match(preflight.headers['Access-Control-Allow-Headers'], /Idempotency-Key/i);
});
test('official variant stock strings and unknown variant stock cannot inherit aggregate InStock', async () => {
  for (const [available, expected] of [['OutOfStock', 'OutOfStock'], [null, 'unknown'], ['InStock', 'InStock']]) {
    const { handler } = setup({ catalog: { freshProduct: async x => { const p = freshProduct(x); p.data.product.variants.options[0].values[0].available = available; return p; } } });
    const response = await handler(event('POST', '/commerce/quotes', requestBody()));
    assert.equal(response.statusCode, 201); assert.equal(json(response).quote.lines[0].availability, expected);
  }
});
test('backend identifiers and Unicode variant limits match catalog and client', async () => {
  const { handler, calls } = setup();
  for (const modify of [b => { b.lines[0].productId = 'x:y'; }, b => { b.lines[0].productId = 'p'.repeat(81); }, b => { b.lines[0].options.Size = '\u0085'; }, b => { b.lines[0].options.Size = '\ud800'; }]) {
    const body = requestBody(); modify(body); assert.equal((await handler(event('POST', '/commerce/quotes', body))).statusCode, 400);
  } assert.equal(calls(), 0);
  const body = requestBody(); body.lines[0].options = { ['N'.repeat(60)]: 'V'.repeat(80) };
  assert.equal((await handler(event('POST', '/commerce/quotes', body))).statusCode, 201);
});
test('quote affiliate URL and commission must remain in the provider documented boundary', async () => {
  for (const url of ['https://evil.example/path', 'https://buy.trychannel3.com:8443/path', 'https://name:pass@buy.trychannel3.com/path']) {
    const { handler } = setup({ catalog: { freshProduct: async x => { const p = freshProduct(x); p.data.product.offers[0].url = url; p.data.product.offers[0].max_commission_rate = 5; return p; } } });
    const response = await handler(event('POST', '/commerce/quotes', requestBody()));
    assert.equal(response.statusCode, 201); assert.equal(json(response).quote.lines[0].offer.url, null); assert.equal(json(response).quote.lines[0].offer.maxCommissionRate, null);
  }
});
test('untrusted errors cannot leak diagnostics by attaching public-looking statusCode and code', async () => {
  const { handler } = setup({ store: { begin: async () => { throw Object.assign(new Error('secret-provider-diagnostic'), { code: 'provider_failed', statusCode: 400 }); } } });
  const response = await handler(event('POST', '/commerce/quotes', requestBody())); assert.equal(response.statusCode, 503); assert.doesNotMatch(response.body, /secret-provider-diagnostic|provider_failed/);
});
test('corrupt persisted order ids timestamps and tracking data are unavailable instead of leaking arbitrary values', async () => {
  const { handler, store } = setup();
  for (const invalid of [{ orderId: '<script>' }, { createdAt: 'not-a-date' }, { updatedAt: 'not-a-date' }]) {
    store.seed('customer-a', 'order', 'order_123456', { orderId: 'order_123456', status: 'confirmed', currency: 'USD', totalMinor: 100, payment: { status: 'succeeded' }, createdAt: new Date(FIXED_NOW).toISOString(), ...invalid });
    assert.equal((await handler(event('GET', '/commerce/orders/order_123456'))).statusCode, 503);
  }
});
test('an overlong upstream expiry cannot extend volatile quote data beyond thirty seconds', async () => {
  const { handler } = setup({ catalog: { freshProduct: async input => {
    const snapshot = freshProduct(input); snapshot.expiresAt = new Date(FIXED_NOW + 300000).toISOString(); return snapshot;
  } } });
  const response = await handler(event('POST', '/commerce/quotes', requestBody()));
  assert.equal(response.statusCode, 201);
  assert.equal(Date.parse(json(response).quote.expiresAt), FIXED_NOW + 30000);
});
test('a snapshot at the thirty-second freshness boundary cannot create a quote', async () => {
  const { handler, store } = setup({ catalog: { freshProduct: async input => {
    const snapshot = freshProduct(input); snapshot.fetchedAt = new Date(FIXED_NOW - 30000).toISOString(); return snapshot;
  } } });
  const response = await handler(event('POST', '/commerce/quotes', requestBody()));
  assert.equal(response.statusCode, 503); assert.equal(store.audits.length, 0);
});
test('all private routes reject wrong JWT authority and expired identity before persistence', async () => {
  let accessed = false;
  const store = new Proxy({}, { get() { accessed = true; throw new Error('Customer persistence must not be accessed'); } });
  const { handler } = setup({ store });
  const routes = [['POST', '/commerce/quotes', requestBody()], ['POST', '/commerce/checkout-attempts', {}], ['GET', '/commerce/orders'], ['GET', '/commerce/orders/order1'], ['POST', '/commerce/orders/order1/cancel', {}], ['POST', '/commerce/orders/order1/refund', {}]];
  const mutations = [claims => { claims.iss = 'https://other.example'; }, claims => { claims.aud = 'other-client'; }, claims => { claims.sub = ''; }, claims => { claims.sub = 'x#OTHER'; }, claims => { claims.exp = String(FIXED_NOW / 1000); }, claims => { claims.token_use = 'access'; }, claims => { delete claims.exp; }];
  for (const [method, path, body] of routes) for (const mutate of mutations) {
    const input = event(method, path, body); mutate(input.requestContext.authorizer.jwt.claims);
    assert.equal((await handler(input)).statusCode, 401);
  }
  assert.equal(accessed, false);
});
test('maximum ten-line cart has one conditional fee, exact quantities and only five distinct hydrations', async () => {
  let calls = 0;
  const { handler } = setup({ catalog: { freshProduct: async input => {
    calls++; const snapshot = freshProduct(input), first = snapshot.data.product.offers[0];
    first.price.price = '0.29'; snapshot.data.product.offers.push({ ...structuredClone(first), domain: 'second.example' }); return snapshot;
  } } });
  const body = requestBody(), original = body.lines[0];
  body.lines = Array.from({ length: 10 }, (_, index) => ({ ...structuredClone(original), productId: 'product' + Math.floor(index / 2), merchantDomain: index % 2 ? 'second.example' : 'merchant.example', quantity: index + 1 }));
  const response = await handler(event('POST', '/commerce/quotes', body)); assert.equal(response.statusCode, 201);
  const quote = json(response).quote; assert.equal(calls, 5);
  assert.deepEqual(quote.lines.map(line => line.lineTotalMinor), [29, 58, 87, 116, 145, 174, 203, 232, 261, 290]);
  assert.equal(quote.costs.components.find(component => component.code === 'products').amountMinor, 1595);
  assert.equal(quote.costs.components.filter(component => component.code === 'anox_service_fee').length, 1);
  assert.equal(quote.costs.components.find(component => component.code === 'anox_service_fee').amountMinor, 500);
  assert.equal(quote.costs.estimatedTotalMinor, null); assert.equal(quote.costs.verifiedPayableTotalMinor, null);
});
test('six distinct selections are rejected without paid or detail work', async () => {
  const { handler, calls } = setup(), body = requestBody();
  body.lines = Array.from({ length: 6 }, (_, index) => ({ ...structuredClone(body.lines[0]), productId: 'product' + index }));
  const response = await handler(event('POST', '/commerce/quotes', body));
  assert.equal(response.statusCode, 422); assert.equal(json(response).error.code, 'quote_too_large'); assert.equal(calls(), 0);
});
test('ambiguous successful persistence can be replayed without another hydration or duplicate audit', async () => {
  const store = new MemoryStore(), complete = store.complete.bind(store); let lostReply = true;
  store.complete = async input => { await complete(input); if (lostReply) { lostReply = false; throw new Error('Transport lost committed transaction reply'); } };
  const { handler, calls } = setup({ store });
  assert.equal((await handler(event('POST', '/commerce/quotes', requestBody()))).statusCode, 503);
  const replay = await handler(event('POST', '/commerce/quotes', requestBody()));
  assert.equal(replay.statusCode, 201); assert.equal(replay.headers['Idempotency-Replayed'], 'true');
  assert.equal(calls(), 1); assert.equal(store.audits.length, 1); assert.equal(store.records.size, 1);
});
test('blocked attempts replay exactly and reject a modified request under the same key', async () => {
  const { handler, store } = setup(); const quote = json(await handler(event('POST', '/commerce/quotes', requestBody()))).quote;
  const body = { quoteId: quote.quoteId, cartRevision: quote.cartRevision, cartHash: quote.cartHash };
  const first = await handler(event('POST', '/commerce/checkout-attempts', body));
  const replay = await handler(event('POST', '/commerce/checkout-attempts', body));
  assert.equal(replay.body, first.body); assert.equal(replay.headers['Idempotency-Replayed'], 'true');
  const modified = await handler(event('POST', '/commerce/checkout-attempts', { ...body, cartRevision: 'changed_revision' }));
  assert.equal(modified.statusCode, 409); assert.equal(json(modified).error.code, 'idempotency_conflict');
  assert.equal(store.audits.filter(audit => audit.type === 'checkout.blocked').length, 1);
  assert.equal([...store.records.keys()].filter(key => ['order', 'payment'].includes(JSON.parse(key)[1])).length, 0);
});
test('permitted upstream clock skew does not grant more than thirty seconds from quote creation', async () => {
  const { handler } = setup({ catalog: { freshProduct: async input => {
    const snapshot = freshProduct(input); snapshot.fetchedAt = new Date(FIXED_NOW + 10000).toISOString(); snapshot.expiresAt = new Date(FIXED_NOW + 40000).toISOString(); return snapshot;
  } } });
  const response = await handler(event('POST', '/commerce/quotes', requestBody()));
  assert.equal(response.statusCode, 201); assert.equal(Date.parse(json(response).quote.expiresAt), FIXED_NOW + 30000);
});
