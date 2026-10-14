const test = require('node:test');
const assert = require('node:assert/strict');
const { createDynamoStore } = require('../backend/commerce/store.js');
const { transitionOrder } = require('../backend/commerce/orders.js');
function fake(results = []) { const calls = []; return { calls, send: async (operation, input) => { calls.push({ operation, input }); const value = results.shift(); if (value instanceof Error) throw value; return value || {}; } }; }
test('Dynamo idempotency creates conditional claim before any downstream work', async () => {
  const db = fake(); const store = createDynamoStore({ send: db.send, tableName: 'test-table' });
  const op = await store.begin({ owner: 'alice', kind: 'quote', key: 'key123', hash: 'request123', now: 1000, leaseMs: 30000 });
  assert.equal(op.status, 'acquired'); const put = db.calls.find(x => x.operation === 'Put');
  assert.match(put.input.ConditionExpression, /attribute_not_exists/); assert.equal(put.input.Item.requestHash, 'request123'); assert.equal(put.input.Item.leaseUntil, 31000); assert.doesNotMatch(put.input.Item.pk, /alice/);
});
test('completed quote and audit are committed atomically under the lease token', async () => {
  const db = fake(); const store = createDynamoStore({ send: db.send, tableName: 'test-table' });
  await store.complete({ owner: 'alice', kind: 'quote', key: 'stablekey', token: 'lease1', result: { quote: { quoteId: 'quote1' } }, record: { kind: 'quote', id: 'quote1', data: { quoteId: 'quote1' }, ttl: 999 }, audit: { eventId: 'audit1', type: 'quote.created', at: '2026-10-09T00:00:00Z' }, now: 1000 });
  assert.equal(db.calls.length, 1); assert.equal(db.calls[0].operation, 'TransactWrite'); const items = db.calls[0].input.TransactItems;
  assert.equal(items.length, 3); assert.match(items[0].Update.ConditionExpression, /token/); assert.match(items[0].Update.ConditionExpression, /leaseUntil > :now/); assert.equal(items[0].Update.ExpressionAttributeValues[':now'], 1000); assert.match(items[1].Put.ConditionExpression, /attribute_not_exists/); assert.match(items[2].Put.Item.sk, /^AUDIT#/);
});
test('customer data retrieval and pagination remain inside owner partition', async () => {
  const db = fake([{ Item: { data: { orderId: 'o1' } } }, { Items: [{ data: { orderId: 'o1' } }], LastEvaluatedKey: { pk: 'P', sk: 'ORDER#o1' } }]);
  const store = createDynamoStore({ send: db.send, tableName: 'test-table' });
  assert.deepEqual(await store.get('alice', 'order', 'o1'), { orderId: 'o1' });
  const page = await store.listOrders('alice', 'cursor123', 20); assert.equal(page.orders[0].orderId, 'o1');
  assert.equal(db.calls[0].input.ConsistentRead, true); assert.equal(db.calls[1].input.ConsistentRead, true); assert.equal(db.calls[1].input.ExclusiveStartKey.pk, db.calls[0].input.Key.pk); assert.match(db.calls[1].input.KeyConditionExpression, /begins_with/);
});
test('stale claim takeover is conditional and binds the original request hash', async () => {
  const db = fake([{ Item: { requestHash: 'same', status: 'working', token: 'old', leaseUntil: 100 } }, {}]);
  const store = createDynamoStore({ send: db.send, tableName: 'test-table' });
  await store.begin({ owner: 'alice', kind: 'quote', key: 'k', hash: 'same', now: 101, leaseMs: 30000 });
  const update = db.calls.find(x => x.operation === 'Put'); assert.match(update.input.ConditionExpression, /token/); assert.match(update.input.ConditionExpression, /leaseUntil/); assert.match(update.input.ConditionExpression, /requestHash/);
});
test('lease token loss and Dynamo transaction conflicts fail closed', async () => {
  const conflict = Object.assign(new Error('conflict'), { name: 'TransactionCanceledException' }); const db = fake([conflict]);
  const store = createDynamoStore({ send: db.send, tableName: 'test-table' });
  await assert.rejects(store.complete({ owner: 'alice', kind: 'quote', key: 'k', token: 'x', result: {}, record: { kind: 'quote', id: 'q', data: {} }, now: 1000 }), { code: 'operation_conflict' });
});
test('order state cannot confirm from redirect, skip fulfillment or ignore compare-and-swap version', () => {
  const order = { status: 'pending', version: 1, payment: { status: 'pending' } };
  assert.throws(() => transitionOrder(order, 'confirmed', 1, 'now'), { code: 'confirmation_unverified' });
  assert.throws(() => transitionOrder(order, 'shipped', 1, 'now'), { code: 'invalid_transition' });
  assert.throws(() => transitionOrder(order, 'failed', 2, 'now'), { code: 'state_conflict' });
  const accepted = { ...order, merchantOrderReference: 'merchant1', payment: { status: 'succeeded' } };
  assert.equal(transitionOrder(accepted, 'confirmed', 1, 'now').version, 2);
});
test('payment transaction fences active reference and identity independently of fulfillment version', async () => {
  const db = fake(); const store = createDynamoStore({ send: db.send, tableName: 'test-table' });
  const binding = { paymentId: 'pi_old', owner: 'alice', orderId: 'o1', attemptId: 'attempt1', expectedAmountMinor: 100, currency: 'usd', account: 'acct_test', livemode: false };
  await store.applyWebhook({ eventId: 'evt_test', binding, expectedOrderVersion: 5, payment: { ...binding, status: 'succeeded' }, audit: { eventId: 'evt_test', at: '2026-10-09T00:00:00.000Z' } });
  const update = db.calls[0].input.TransactItems.find(x => x.Update)?.Update;
  assert.equal(update.ExpressionAttributeValues[':expected'], 5); assert.match(update.ConditionExpression, /paymentId/); assert.match(update.ConditionExpression, /attemptId/); assert.match(update.ConditionExpression, /livemode/); assert.match(update.ConditionExpression, /currency/);
  assert.ok(db.calls[0].input.TransactItems.some(x => x.ConditionCheck));
});
