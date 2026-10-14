'use strict';
const crypto = require('node:crypto');
const { fail } = require('./errors.js');
const LIMITS = Object.freeze({ maxLines: 10, maxDistinctProducts: 5, maxQuantityPerLine: 20 });
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
function object(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('invalid_request', 'Expected a plain JSON object.');
  if (Object.keys(value).some(key => forbidden.has(key) || !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail('invalid_request', 'Missing or unsupported request fields.');
  return value;
}
function text(value, max = 160) { return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
const productKey = line => canonical({ productId: line.productId, options: line.options });
function quoteInput(input) {
  object(input, ['cartRevision', 'lines', 'destination', 'currency']);
  if (!ID.test(input.cartRevision || '') || typeof input.cartRevision !== 'string') fail('invalid_request', 'An opaque cart revision is required.');
  if (input.currency !== 'USD') fail('unsupported_currency', 'Only USD quotes are currently supported.', 422);
  object(input.destination, ['country']); if (input.destination.country !== 'DZ') fail('unsupported_destination', 'Only Algeria quotes are currently supported.', 422);
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > LIMITS.maxLines) fail('quote_too_large', 'A quote requires one to ten cart lines.', 422);
  const lines = input.lines.map(line => {
    object(line, ['provider', 'productId', 'merchantDomain', 'condition', 'quantity', 'options']);
    if (line.provider !== 'channel3') fail('unsupported_provider', 'This catalog provider is not supported.', 422);
    if (typeof line.productId !== 'string' || !ID.test(line.productId)) fail('invalid_request', 'Invalid product identifier.');
    if (typeof line.merchantDomain !== 'string' || line.merchantDomain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(line.merchantDomain)) fail('invalid_request', 'Invalid merchant domain.');
    if (line.condition !== null && line.condition !== 'new' && line.condition !== 'used') fail('invalid_request', 'Invalid product condition.');
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > LIMITS.maxQuantityPerLine) fail('invalid_request', 'Quantity must be between one and twenty.');
    if (!line.options || typeof line.options !== 'object' || Array.isArray(line.options) || Object.getPrototypeOf(line.options) !== Object.prototype || Object.keys(line.options).length > 8) fail('invalid_request', 'Invalid variant options.');
    for (const [name, value] of Object.entries(line.options)) if (forbidden.has(name) || !text(name, 60) || !text(value, 80)) fail('invalid_request', 'Invalid variant selection.');
    return { provider: 'channel3', productId: line.productId, merchantDomain: line.merchantDomain, condition: line.condition, quantity: line.quantity, options: Object.fromEntries(Object.entries(line.options).sort(([a], [b]) => a.localeCompare(b))) };
  });
  if (new Set(lines.map(productKey)).size > LIMITS.maxDistinctProducts) fail('quote_too_large', 'A quote supports at most five distinct product selections.', 422);
  const identities = lines.map(({ quantity, ...identity }) => canonical(identity));
  if (new Set(identities).size !== identities.length) fail('duplicate_line', 'Combine identical selections into a single cart line.', 422);
  return { cartRevision: input.cartRevision, lines, destination: { country: 'DZ' }, currency: 'USD' };
}
function attemptInput(input) {
  object(input, ['quoteId', 'cartRevision', 'cartHash']);
  if (typeof input.quoteId !== 'string' || !ID.test(input.quoteId) || typeof input.cartRevision !== 'string' || !ID.test(input.cartRevision) || typeof input.cartHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.cartHash)) fail('invalid_request', 'Invalid quote or cart binding.');
  return input;
}
function idempotencyKey(headers) {
  const key = headers['idempotency-key']; if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) fail('idempotency_key_required', 'Use a stable 16–128 character Idempotency-Key for retries.'); return key;
}
module.exports = { LIMITS, ID, object, text, canonical, hash, productKey, quoteInput, attemptInput, idempotencyKey };
