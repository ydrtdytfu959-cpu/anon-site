const crypto = require('node:crypto');
const { CommerceError } = require('../../backend/commerce/errors.js');
const clone = (value) => value === undefined ? undefined : structuredClone(value);
function fail(code, statusCode = 409) { return new CommerceError(code, code, statusCode); }
// A deterministic transactional fake. Production never imports this module.
class MemoryStore {
  constructor() { this.operations = new Map(); this.records = new Map(); this.audits = []; this.webhooks = new Set(); this.bindings = new Map(); }
  operationKey(owner, kind, key) { return JSON.stringify([owner, kind, key]); }
  recordKey(owner, kind, id) { return JSON.stringify([owner, kind, id]); }
  async begin({ owner, kind, key, hash, now, leaseMs }) {
    const id = this.operationKey(owner, kind, key), previous = this.operations.get(id);
    if (previous && previous.hash !== hash) throw fail('idempotency_conflict');
    if (previous?.status === 'complete') return { status: 'complete', result: clone(previous.result) };
    if (previous && previous.leaseUntil > now) throw fail('operation_in_progress');
    const token = crypto.randomUUID(); this.operations.set(id, { hash, token, status: 'working', leaseUntil: now + leaseMs });
    return { status: 'acquired', token };
  }
  async complete({ owner, kind, key, token, result, record, audit, now }) {
    const operation = this.operations.get(this.operationKey(owner, kind, key));
    if (operation?.token !== token || operation.status !== 'working' || operation.leaseUntil <= now) throw fail('operation_conflict');
    if (record && this.records.has(this.recordKey(owner, record.kind, record.id))) throw fail('record_conflict');
    if (record) this.records.set(this.recordKey(owner, record.kind, record.id), clone(record.data));
    if (audit) this.audits.push(clone(audit));
    Object.assign(operation, { status: 'complete', result: clone(result) });
  }
  async release({ owner, kind, key, token }) {
    const op = this.operations.get(this.operationKey(owner, kind, key)); if (op?.token === token && op.status === 'working') op.leaseUntil = 0;
  }
  async get(owner, kind, id) { return clone(this.records.get(this.recordKey(owner, kind, id))); }
  seed(owner, kind, id, value) { this.records.set(this.recordKey(owner, kind, id), clone(value)); }
  async listOrders(owner, cursor, limit) {
    const records = [...this.records.entries()].filter(([key]) => { const k = JSON.parse(key); return k[0] === owner && k[1] === 'order'; }).map(([, value]) => value).sort((a, b) => a.orderId.localeCompare(b.orderId));
    const start = cursor ? records.findIndex(v => v.orderId > cursor) : 0;
    const items = records.slice(start < 0 ? records.length : start, (start < 0 ? records.length : start) + limit);
    return { orders: clone(items), nextCursor: items.length === limit && records.some(v => v.orderId > items.at(-1).orderId) ? items.at(-1).orderId : null };
  }
  async getPaymentBinding(id) { return clone(this.bindings.get(id)); }
  async hasWebhook(id) { return this.webhooks.has(id); }
  async applyWebhook({ eventId, binding, expectedOrderVersion, payment, audit }) {
    if (this.webhooks.has(eventId)) return { duplicate: true };
    const current = this.records.get(this.recordKey(binding.owner, 'order', binding.orderId));
    if (!current || current.version !== expectedOrderVersion || current.payment.amountMinor !== binding.expectedAmountMinor || ['paymentId', 'attemptId', 'currency', 'account', 'livemode'].some(field => current.payment[field] !== binding[field])) throw fail('state_conflict');
    current.payment = clone(payment); current.version += 1;
    this.webhooks.add(eventId); this.audits.push(clone(audit)); return { duplicate: false };
  }
}
const FIXED_NOW = Date.parse('2026-10-09T16:00:00.000Z');
const ISSUER = 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_TestPool';
const CLIENT_ID = 'test-client';
const requestBody = () => ({ cartRevision: 'cart_revision_123456', lines: [{ provider: 'channel3', productId: 'product1', merchantDomain: 'merchant.example', condition: 'new', quantity: 2, options: { Size: 'M' } }], destination: { country: 'DZ' }, currency: 'USD' });
function freshProduct({ productId = 'product1', options = { Size: 'M' } } = {}) {
  return { provider: 'channel3', status: 'fresh', fetchedAt: new Date(FIXED_NOW).toISOString(), expiresAt: new Date(FIXED_NOW + 60000).toISOString(), error: null, selectionMismatch: [], data: { product: { id: productId, title: 'Verified provider title', offers: [{ domain: 'merchant.example', url: 'https://buy.trychannel3.com/item?affiliate=preserved', price: { price: 19.99, currency: 'USD' }, condition: 'new', availability: 'InStock', max_commission_rate: 0.03 }], variants: { options: Object.entries(options).map(([name, label]) => ({ name, values: [{ label, exists: true, available: 'InStock' }] })), selected: Object.entries(options).map(([name, label]) => ({ name, label })) } } } };
}
function event(method, path, body, overrides = {}) {
  return { version: '2.0', rawPath: path, routeKey: method + ' ' + path, headers: { origin: 'https://anox.app', 'content-type': 'application/json', 'idempotency-key': 'operation-key-000001' }, requestContext: { http: { method }, authorizer: { jwt: { claims: { sub: 'customer-a', iss: ISSUER, aud: CLIENT_ID, token_use: 'id', exp: String(Math.floor(FIXED_NOW / 1000) + 3600) } } } }, body: body === undefined ? undefined : JSON.stringify(body), ...overrides };
}
const config = { issuer: ISSUER, clientId: CLIENT_ID, allowedOrigin: 'https://anox.app' };
module.exports = { MemoryStore, FIXED_NOW, ISSUER, CLIENT_ID, requestBody, freshProduct, event, config };
