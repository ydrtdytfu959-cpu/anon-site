'use strict';
const crypto = require('node:crypto');
const { hash } = require('./validation.js');
const { fail } = require('./errors.js');
function createDynamoStore({ send, tableName }) {
  if (!tableName || typeof send !== 'function') throw Error('Commerce persistence is not configured.');
  const partition = owner => 'CUSTOMER#' + hash(owner);
  const keyFor = (owner, kind, id) => ({ pk: partition(owner), sk: kind.toUpperCase() + '#' + id });
  const operationKey = (owner, kind, key) => ({ pk: partition(owner), sk: 'IDEM#' + kind + '#' + hash(key) });
  const putUnique = Item => ({ Put: { TableName: tableName, Item, ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' } });
  const getItem = async Key => (await send('Get', { TableName: tableName, Key, ConsistentRead: true })).Item;
  const conditional = error => error.name === 'ConditionalCheckFailedException' || error.name === 'TransactionCanceledException';
  async function begin({ owner, kind, key, hash: requestHash, now, leaseMs }) {
    const Key = operationKey(owner, kind, key), previous = await getItem(Key);
    // An expired record still present is not ignored. TTL is cleanup, not authority.
    if (previous && previous.requestHash !== requestHash) fail('idempotency_conflict', 'This key was already used for different input.', 409);
    if (previous?.status === 'complete') return { status: 'complete', result: previous.result };
    if (previous?.leaseUntil > now) fail('operation_in_progress', 'This operation is already running. Retry with the same key.', 409);
    const token = crypto.randomUUID(), Item = { ...Key, requestHash, status: 'working', token, leaseUntil: now + leaseMs, ttl: Math.floor(now / 1000) + 86400 };
    const condition = previous ? { ConditionExpression: 'token = :previous AND leaseUntil <= :now AND requestHash = :hash AND #status = :working', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':previous': previous.token, ':now': now, ':hash': requestHash, ':working': 'working' } } : { ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' };
    try { await send('Put', { TableName: tableName, Item, ...condition }); }
    catch (error) {
      if (!conditional(error)) throw error;
      const winner = await getItem(Key);
      if (winner?.requestHash !== requestHash) fail('idempotency_conflict', 'This key was already used for different input.', 409);
      if (winner?.status === 'complete') return { status: 'complete', result: winner.result };
      fail('operation_in_progress', 'This operation is already running. Retry with the same key.', 409);
    }
    return { status: 'acquired', token };
  }
  async function complete({ owner, kind, key, token, result, record, audit, now }) {
    const TransactItems = [{ Update: { TableName: tableName, Key: operationKey(owner, kind, key), UpdateExpression: 'SET #status = :complete, #result = :result, ttl = :ttl', ConditionExpression: 'token = :token AND #status = :working AND leaseUntil > :now', ExpressionAttributeNames: { '#status': 'status', '#result': 'result' }, ExpressionAttributeValues: { ':complete': 'complete', ':working': 'working', ':result': result, ':token': token, ':now': now, ':ttl': Math.floor(now / 1000) + 86400 } } }];
    if (record) TransactItems.push(putUnique({ ...keyFor(owner, record.kind, record.id), data: record.data, ...(record.ttl ? { ttl: record.ttl } : {}) }));
    if (audit) TransactItems.push(putUnique({ pk: partition(owner), sk: 'AUDIT#' + audit.at + '#' + audit.eventId, data: audit }));
    try { await send('TransactWrite', { TransactItems, ClientRequestToken: token }); }
    catch (error) { if (conditional(error)) fail('operation_conflict', 'The operation changed before it could be committed. Retry with the same key.', 409); throw error; }
  }
  async function release({ owner, kind, key, token }) {
    try { await send('Update', { TableName: tableName, Key: operationKey(owner, kind, key), UpdateExpression: 'SET leaseUntil = :zero', ConditionExpression: 'token = :token AND #status = :working', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':zero': 0, ':token': token, ':working': 'working' } }); }
    catch (error) { if (!conditional(error)) throw error; }
  }
  async function get(owner, kind, id) { return (await getItem(keyFor(owner, kind, id)))?.data; }
  async function listOrders(owner, cursor, limit) {
    const pk = partition(owner), result = await send('Query', { TableName: tableName, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': pk, ':prefix': 'ORDER#' }, ConsistentRead: true, Limit: limit, ...(cursor ? { ExclusiveStartKey: { pk, sk: 'ORDER#' + cursor } } : {}) });
    return { orders: (result.Items || []).map(item => item.data), nextCursor: result.LastEvaluatedKey?.sk?.slice('ORDER#'.length) || null };
  }
  async function transition({ owner, orderId, expectedVersion, next, audit }) {
    if (!Number.isSafeInteger(expectedVersion) || next.version !== expectedVersion + 1 || next.orderId !== orderId) fail('state_conflict', 'Invalid order transition version.', 409);
    const changes = [{ Put: { TableName: tableName, Item: { ...keyFor(owner, 'order', orderId), data: next }, ConditionExpression: '#data.#version = :expected', ExpressionAttributeNames: { '#data': 'data', '#version': 'version' }, ExpressionAttributeValues: { ':expected': expectedVersion } } }, putUnique({ pk: partition(owner), sk: 'AUDIT#' + audit.at + '#' + audit.eventId, data: audit })];
    try { await send('TransactWrite', { TransactItems: changes }); } catch (error) { if (conditional(error)) fail('state_conflict', 'The order changed before the update.', 409); throw error; }
  }
  async function getPaymentBinding(id) { return (await getItem({ pk: 'PAYMENT#' + hash(id), sk: 'BINDING' }))?.data; }
  async function hasWebhook(id) { return Boolean(await getItem({ pk: 'STRIPE#' + hash(id), sk: 'RECEIPT' })); }
  async function applyWebhook({ eventId, binding, expectedOrderVersion, payment, audit }) {
    if (!Number.isSafeInteger(expectedOrderVersion) || expectedOrderVersion < 1) fail('state_conflict', 'Invalid order version.', 409);
    const receipt = { pk: 'STRIPE#' + hash(eventId), sk: 'RECEIPT', data: { eventId, orderId: binding.orderId, at: audit.at } };
    const identity = ['paymentId', 'attemptId', 'currency', 'account', 'livemode'];
    const names = Object.fromEntries(identity.map(field => ['#' + field, field]));
    const values = Object.fromEntries(identity.map(field => [':' + field, binding[field]]));
    const TransactItems = [putUnique(receipt), { Update: { TableName: tableName, Key: keyFor(binding.owner, 'order', binding.orderId), UpdateExpression: 'SET #data.#payment = :payment, #data.#version = :next, #data.#updatedAt = :at', ConditionExpression: '#data.#version = :expected AND #data.#payment.#amountMinor = :amount AND ' + identity.map(field => '#data.#payment.#' + field + ' = :' + field).join(' AND '), ExpressionAttributeNames: { '#data': 'data', '#payment': 'payment', '#version': 'version', '#updatedAt': 'updatedAt', '#amountMinor': 'amountMinor', ...names }, ExpressionAttributeValues: { ':payment': payment, ':next': expectedOrderVersion + 1, ':expected': expectedOrderVersion, ':at': audit.at, ':amount': binding.expectedAmountMinor, ...values } } }, { ConditionCheck: { TableName: tableName, Key: { pk: 'PAYMENT#' + hash(binding.paymentId), sk: 'BINDING' }, ConditionExpression: '#data.#owner = :owner AND #data.#orderId = :orderId AND #data.#expectedAmountMinor = :amount AND ' + identity.map(field => '#data.#' + field + ' = :' + field).join(' AND '), ExpressionAttributeNames: { '#data': 'data', '#owner': 'owner', '#orderId': 'orderId', '#expectedAmountMinor': 'expectedAmountMinor', ...names }, ExpressionAttributeValues: { ':owner': binding.owner, ':orderId': binding.orderId, ':amount': binding.expectedAmountMinor, ...values } } }, putUnique({ pk: partition(binding.owner), sk: 'AUDIT#' + audit.at + '#' + audit.eventId, data: audit })];
    try { await send('TransactWrite', { TransactItems }); return { duplicate: false }; }
    catch (error) { if (conditional(error)) { if (await hasWebhook(eventId)) return { duplicate: true }; fail('state_conflict', 'Concurrent payment update; retry the signed event.', 409); } throw error; }
  }
  return { begin, complete, release, get, listOrders, transition, getPaymentBinding, hasWebhook, applyWebhook };
}
module.exports = { createDynamoStore };
