const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyStripeSignature, processStripeEvent } = require('../backend/commerce/webhooks.js');
const { MemoryStore, FIXED_NOW } = require('./helpers/commerce.cjs');
const secret = 'whsec_local_test_only';
function signature(body, timestamp = Math.floor(FIXED_NOW / 1000)) { return `t=${timestamp},v1=${crypto.createHmac('sha256', secret).update(timestamp + '.').update(body).digest('hex')}`; }
function payload(type = 'payment_intent.succeeded') { return { id: 'evt_test123456', object: 'event', type, account: 'acct_merchant', livemode: false, created: Math.floor(FIXED_NOW / 1000), data: { object: { id: 'pi_test123456', object: 'payment_intent', amount: 5499, amount_received: 5499, currency: 'usd', livemode: false, metadata: { anox_attempt_id: 'attempt123456', anox_order_id: 'order123456' } } } }; }
function setup() {
  const store = new MemoryStore(); const binding = { paymentId: 'pi_test123456', owner: 'alice', orderId: 'order123456', attemptId: 'attempt123456', expectedAmountMinor: 5499, currency: 'usd', account: 'acct_merchant', livemode: false, orderVersion: 1 };
  store.bindings.set(binding.paymentId, binding); store.seed('alice', 'order', binding.orderId, { orderId: binding.orderId, version: 1, status: 'pending', payment: { paymentId: binding.paymentId, attemptId: binding.attemptId, currency: binding.currency, account: binding.account, livemode: binding.livemode, status: 'pending', amountMinor: 5499, refundedMinor: 0 } }); return { store, binding };
}
test('Stripe verification signs the exact raw bytes and accepts rotating v1 signatures', () => {
  const rawBody = Buffer.from(JSON.stringify(payload())); const signed = signature(rawBody);
  assert.equal(verifyStripeSignature({ rawBody, signature: signed, secret, now: FIXED_NOW }).id, 'evt_test123456');
  assert.equal(verifyStripeSignature({ rawBody, signature: signed + ',v1=' + '0'.repeat(64), secret, now: FIXED_NOW }).id, 'evt_test123456');
  assert.throws(() => verifyStripeSignature({ rawBody: Buffer.from(JSON.stringify(payload(), null, 2)), signature: signed, secret, now: FIXED_NOW }), { code: 'invalid_signature' });
});
test('Stripe verification rejects stale future malformed and absent signature/secret inputs', () => {
  const rawBody = Buffer.from(JSON.stringify(payload()));
  for (const signed of ['', signature(rawBody, Math.floor(FIXED_NOW / 1000) - 301), signature(rawBody, Math.floor(FIXED_NOW / 1000) + 301), 't=1,t=2,v1=abc']) assert.throws(() => verifyStripeSignature({ rawBody, signature: signed, secret, now: FIXED_NOW }));
  assert.throws(() => verifyStripeSignature({ rawBody, signature: signature(rawBody), secret: '', now: FIXED_NOW }));
});
test('signed payment success updates payment only, with idempotent durable receipt and audit', async () => {
  const { store } = setup(); const first = await processStripeEvent({ event: payload(), store, now: FIXED_NOW }); assert.equal(first.duplicate, false);
  const order = await store.get('alice', 'order', 'order123456'); assert.equal(order.payment.status, 'succeeded'); assert.equal(order.status, 'pending');
  assert.equal((await processStripeEvent({ event: payload(), store, now: FIXED_NOW })).duplicate, true); assert.equal(store.audits.length, 1);
});
test('payment event is rejected unless reference amount currency account environment and metadata match pre-existing binding', async () => {
  const mutations = [e => { e.data.object.id = 'pi_unknown'; }, e => { e.data.object.amount_received = 1; }, e => { e.data.object.currency = 'eur'; }, e => { e.account = 'acct_wrong'; }, e => { e.livemode = true; }, e => { e.data.object.livemode = true; }, e => { e.data.object.metadata.anox_attempt_id = 'wrong'; }, e => { e.data.object.metadata.anox_order_id = 'wrong'; }];
  for (const mutate of mutations) { const { store } = setup(), p = payload(); mutate(p); await assert.rejects(processStripeEvent({ event: p, store, now: FIXED_NOW })); assert.equal(store.webhooks.size, 0); }
});
test('reordered failure and processing notifications cannot downgrade succeeded payment', async () => {
  const { store } = setup(); await processStripeEvent({ event: payload(), store, now: FIXED_NOW });
  for (const [i, type] of ['payment_intent.payment_failed', 'payment_intent.processing'].entries()) { const p = payload(type); p.id = 'evt_reordered' + i; await processStripeEvent({ event: p, store, now: FIXED_NOW }); }
  assert.equal((await store.get('alice', 'order', 'order123456')).payment.status, 'succeeded');
});
test('refund amounts are monotonic and capped by verified principal; duplicate events are harmless', async () => {
  const { store } = setup(); await processStripeEvent({ event: payload(), store, now: FIXED_NOW });
  const p = payload('charge.refunded'); p.id = 'evt_refund1'; p.data.object = { ...p.data.object, id: 'ch_test1', object: 'charge', payment_intent: 'pi_test123456', amount_refunded: 1000 };
  await processStripeEvent({ event: p, store, now: FIXED_NOW }); assert.equal((await store.get('alice', 'order', 'order123456')).payment.status, 'partially_refunded');
  p.id = 'evt_refund2'; p.data.object.amount_refunded = 500; await processStripeEvent({ event: p, store, now: FIXED_NOW }); assert.equal((await store.get('alice', 'order', 'order123456')).payment.refundedMinor, 1000);
  p.id = 'evt_refund3'; p.data.object.amount_refunded = 5500; await assert.rejects(processStripeEvent({ event: p, store, now: FIXED_NOW }));
});
test('fulfillment version advances do not permanently block a later payment refund', async () => {
  const { store, binding } = setup(); await processStripeEvent({ event: payload(), store, now: FIXED_NOW });
  const order = await store.get(binding.owner, 'order', binding.orderId); order.version += 1; order.status = 'shipped'; store.seed(binding.owner, 'order', binding.orderId, order);
  const p = payload('charge.refunded'); p.id = 'evt_afterShipment'; p.data.object = { ...p.data.object, id: 'ch_test1', object: 'charge', payment_intent: binding.paymentId, amount_refunded: 5499 };
  await processStripeEvent({ event: p, store, now: FIXED_NOW }); assert.equal((await store.get(binding.owner, 'order', binding.orderId)).payment.status, 'refunded');
});
test('an old same-amount payment cannot confirm a new active checkout attempt', async () => {
  const { store, binding } = setup(), order = await store.get(binding.owner, 'order', binding.orderId);
  order.payment.paymentId = 'pi_newActive'; order.payment.attemptId = 'attempt_newActive'; store.seed(binding.owner, 'order', binding.orderId, order);
  await assert.rejects(processStripeEvent({ event: payload(), store, now: FIXED_NOW }), { code: 'payment_binding_mismatch' });
  assert.equal(store.webhooks.size, 0); assert.equal((await store.get(binding.owner, 'order', binding.orderId)).payment.status, 'pending');
});
