'use strict';
const crypto = require('node:crypto');
const { CommerceError, fail } = require('./errors.js');
const { LIMITS, ID, hash, quoteInput, attemptInput, idempotencyKey, object } = require('./validation.js');
const { checkout, serviceFee } = require('./providers.js');
const { buildServiceRequest, publicServiceRequest } = require('./service-requests.js');
const { buildQuote } = require('./quote.js');
const { publicOrder } = require('./orders.js');
const SAFE_FAILURE_CLASSES = Object.freeze({
  TimeoutError: 'timeout', AbortError: 'timeout', RequestTimeout: 'timeout',
  AccessDeniedException: 'access_denied', ResourceNotFoundException: 'resource_missing',
  ProvisionedThroughputExceededException: 'throttled', ThrottlingException: 'throttled',
  TransactionConflictException: 'transaction_conflict', TransactionInProgressException: 'transaction_conflict'
});
function diagnosticClass(error) {
  // Log only a constant category. Never emit SDK errors, customer identifiers,
  // request bodies, upstream credentials or stack traces.
  return Object.hasOwn(SAFE_FAILURE_CLASSES, error?.name) ? SAFE_FAILURE_CLASSES[error.name] : 'unclassified';
}
function createHandler({ store, catalog, config = {}, now = Date.now, randomId = crypto.randomUUID, hydrationTimeoutMs = 9000, logger = console }) {
  const settings = { allowedOrigin: 'https://anox.app', ...config };
  function owner(event) {
    const claims = event.requestContext?.authorizer?.jwt?.claims;
    if (!settings.issuer || !settings.clientId || !claims || typeof claims.sub !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(claims.sub) || claims.iss !== settings.issuer || claims.token_use !== 'id' || claims.aud !== settings.clientId || !Number.isFinite(Number(claims.exp)) || Number(claims.exp) * 1000 <= now()) fail('unauthorized', 'Sign in to access commerce information.', 401);
    return claims.sub;
  }
  function parseBody(event, headers) {
    if (!/^application\/json(?:\s*;.*)?$/i.test(headers['content-type'] || '')) fail('invalid_content_type', 'Use application/json.', 415);
    if (typeof event.body !== 'string' || event.body.length > 45000) fail('invalid_request', 'Request body is missing or too large.', 413);
    let body = event.body;
    if (event.isBase64Encoded) { if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body)) fail('invalid_request', 'Invalid encoded request.'); body = Buffer.from(body, 'base64').toString('utf8'); }
    if (Buffer.byteLength(body) > 32000) fail('invalid_request', 'Request body is too large.', 413);
    try { return JSON.parse(body); } catch { fail('invalid_request', 'Malformed JSON request.'); }
  }
  async function operation({ customer, kind, key, input, build }) {
    const requestHash = hash(input), current = now();
    const begun = await store.begin({ owner: customer, kind, key, hash: requestHash, now: current, leaseMs: 30000 });
    if (begun.status === 'complete') return { payload: kind === 'service_request' ? { schemaVersion: 1, serviceRequest: publicServiceRequest(begun.result.serviceRequest) } : begun.result, replayed: true };
    try {
      let value = await build();
      const metadata = kind === 'quote' ? { field: 'quote', recordKind: 'quote', id: value.quoteId, event: 'quote.created' } : kind === 'service_request' ? { field: 'serviceRequest', recordKind: 'order', id: value.orderId, event: 'service_request.received' } : { field: 'attempt', recordKind: 'attempt', id: value.attemptId, event: 'checkout.blocked' };
      // A quote has one service record even when two tabs choose different
      // idempotency keys. The unique record transaction fences the first writer.
      const existing = kind === 'service_request' ? await store.get(customer, 'order', metadata.id) : null;
      if (existing) {
        if (existing.kind !== 'service_request' || existing.quoteId !== value.quoteId || existing.cartHash !== value.cartHash || existing.cartRevision !== value.cartRevision) fail('operation_conflict', 'This request record conflicts with the reviewed quote.', 409);
        value = existing;
      }
      const result = { schemaVersion: 1, [metadata.field]: kind === 'service_request' ? publicServiceRequest(value) : value };
      await store.complete({ owner: customer, kind, key, token: begun.token, result, record: existing ? undefined : { kind: metadata.recordKind, id: metadata.id, data: value, ...(kind === 'quote' ? { ttl: Math.floor(now() / 1000) + 86400 } : {}) }, audit: existing ? undefined : { eventId: randomId(), type: metadata.event, resourceId: metadata.id, at: new Date(now()).toISOString() }, now: now() });
      return { payload: result, replayed: false };
    } catch (error) { await store.release({ owner: customer, kind, key, token: begun.token }).catch(() => {}); throw error; }
  }
  return async function handler(event) {
    const headers = Object.fromEntries(Object.entries(event?.headers || {}).map(([name, value]) => [name.toLowerCase(), value]));
    const origin = headers.origin, responseHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
    if (!origin || origin === settings.allowedOrigin) { responseHeaders['Access-Control-Allow-Origin'] = settings.allowedOrigin; responseHeaders['Access-Control-Allow-Headers'] = 'Content-Type,Authorization,Idempotency-Key'; responseHeaders['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS'; responseHeaders['Access-Control-Expose-Headers'] = 'Idempotency-Replayed,Retry-After'; }
    const respond = (statusCode, payload, additional = {}) => ({ statusCode, headers: { ...responseHeaders, ...additional }, body: JSON.stringify(payload) });
    try {
      if (origin && origin !== settings.allowedOrigin) fail('origin_not_allowed', 'This origin is not allowed.', 403);
      const method = event?.requestContext?.http?.method, path = event?.rawPath;
      if (event?.version !== '2.0' || typeof path !== 'string' || !path.startsWith('/commerce/')) fail('not_found', 'Route not found.', 404);
      if (method === 'OPTIONS') return respond(204, null);
      if (method === 'GET' && path === '/commerce/capabilities') return respond(200, { schemaVersion: 1, quote: { enabled: true, limits: LIMITS }, checkout: checkout(), orders: { read: true, cancel: false, refund: false }, serviceRequests: { create: true, read: true, paymentRequired: false }, serviceFee: serviceFee() });
      if (path === '/commerce/webhooks/stripe') fail('webhook_disabled', 'Payment webhooks are not activated for this unsupported checkout integration.', 409);
      const customer = owner(event);
      if (method === 'POST' && path === '/commerce/quotes') {
        const input = quoteInput(parseBody(event, headers)), key = idempotencyKey(headers);
        const result = await operation({ customer, kind: 'quote', key, input, build: () => buildQuote({ input, catalog, now, randomId, hydrationTimeoutMs }) });
        return respond(201, result.payload, result.replayed ? { 'Idempotency-Replayed': 'true' } : {});
      }
      if (method === 'POST' && (path === '/commerce/checkout-attempts' || path === '/commerce/service-requests')) {
        const isServiceRequest = path === '/commerce/service-requests';
        const input = attemptInput(parseBody(event, headers)), key = idempotencyKey(headers);
        const result = await operation({ customer, kind: isServiceRequest ? 'service_request' : 'attempt', key, input, build: async () => {
          const quote = await store.get(customer, 'quote', input.quoteId); if (!quote) fail('quote_not_found', 'Quote not found.', 404);
          if (quote.cartRevision !== input.cartRevision || quote.cartHash !== input.cartHash) fail('cart_changed', 'The quote does not match the reviewed cart.', 409);
          if (!Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= now()) fail('quote_expired', 'The quote expired. Request a fresh quote.', 409);
          if (isServiceRequest) return buildServiceRequest({ quote, now: now(), randomId });
          return { attemptId: randomId(), quoteId: quote.quoteId, cartHash: quote.cartHash, cartRevision: quote.cartRevision, status: 'blocked', createdAt: new Date(now()).toISOString(), checkout: quote.checkout };
        } }); return respond(201, result.payload, result.replayed ? { 'Idempotency-Replayed': 'true' } : {});
      }
      if (method === 'GET' && path === '/commerce/orders') {
        const query = event.queryStringParameters || {}; object(query, ['cursor'], []);
        if (query.cursor !== undefined && (typeof query.cursor !== 'string' || !ID.test(query.cursor))) fail('invalid_request', 'Invalid order cursor.');
        const page = await store.listOrders(customer, query.cursor || null, 20);
        return respond(200, { schemaVersion: 1, orders: page.orders.map(publicOrder), nextCursor: page.nextCursor });
      }
      const match = path.match(/^\/commerce\/orders\/([A-Za-z0-9_-]{1,80})(?:\/(cancel|refund))?$/);
      if (match && ((method === 'GET' && !match[2]) || (method === 'POST' && match[2]))) {
        const order = await store.get(customer, 'order', match[1]); if (!order) fail('order_not_found', 'Order not found.', 404);
        if (match[2]) { object(parseBody(event, headers), []); fail('operation_unsupported', 'This merchant integration does not support ' + (match[2] === 'cancel' ? 'cancellation.' : 'refunds.'), 409); }
        return respond(200, { schemaVersion: 1, order: publicOrder(order) });
      }
      fail('not_found', 'Route not found.', 404);
    } catch (error) {
      const known = error instanceof CommerceError;
      const statusCode = known ? error.statusCode : 503, code = known ? error.code : 'service_unavailable';
      logger.error?.(JSON.stringify({ service: 'commerce', outcome: code, statusCode, ...(statusCode === 503 ? { diagnostic: known ? 'handled_failure' : diagnosticClass(error) } : {}) }));
      return respond(statusCode, { schemaVersion: 1, error: { code, message: known ? error.message : 'Commerce is temporarily unavailable. Please retry.' } }, statusCode === 503 || code === 'operation_in_progress' ? { 'Retry-After': '2' } : {});
    }
  };
}
module.exports = { createHandler };
