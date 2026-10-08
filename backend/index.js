'use strict';
const {createHash, randomUUID} = require('node:crypto');

const VERSION = 1;
const SEARCH_TTL = 300_000, DISCOVERY_TTL = 600_000, CURSOR_TTL = 1_800_000;
const MAX_PAGE_BYTES = 300 * 1024, MAX_UPSTREAM_BYTES = 2 * 1024 * 1024;
const LEASE_MS = 25_000; // Longer than the Lambda's 20s invocation deadline.
const SECTIONS = Object.freeze({
  featured: 'popular fashion', men: "men's fashion", women: "women's fashion",
  shoes: 'shoes', clothing: 'clothing', beauty: 'beauty products',
  accessories: 'fashion accessories', sports: 'sportswear', brands: 'fashion brands'
});
class SafeError extends Error {
  constructor(status, code) {super(code); this.status = status; this.code = code;}
}
const fail = (status, code) => {throw new SafeError(status, code);};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cleanString = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const tokenValid = value => typeof value === 'string' && value.length > 0 && value.length <= 8192 && value.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(value);
const cursorKey = (context, token) => 'cursor#' + hash([VERSION, context, token]);
function safeUrl(value, host) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {const url = new URL(value); return url.protocol === 'https:' && url.hostname === host && !url.username && !url.password && !url.port ? url.href : '';}
  catch {return '';}
}
function filtersFor(raw) {
  if (raw === undefined) return {};
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 2048) fail(400, 'INVALID_FILTERS');
  let input; try {input = JSON.parse(raw);} catch {fail(400, 'INVALID_FILTERS');}
  if (!object(input) || Object.keys(input).some(key => !['conditions', 'availability'].includes(key))) fail(400, 'INVALID_FILTERS');
  const output = {};
  for (const key of ['availability', 'conditions']) {
    if (!(key in input)) continue;
    const allowed = key === 'conditions' ? ['new', 'used'] : ['InStock', 'OutOfStock'];
    if (!Array.isArray(input[key]) || !input[key].length || input[key].length > 2 || input[key].some(value => !allowed.includes(value))) fail(400, 'INVALID_FILTERS');
    output[key] = [...new Set(input[key])].sort();
  }
  return output;
}
function parseRequest(event) {
  if (event?.requestContext?.http?.method !== 'GET') fail(405, 'METHOD_NOT_ALLOWED');
  if (event.rawPath && event.rawPath !== '/catalog/search') fail(404, 'NOT_FOUND');
  let params = event.queryStringParameters || {};
  if (!object(params)) fail(400, 'INVALID_QUERY');
  if (typeof event.rawQueryString === 'string') {
    if (Buffer.byteLength(event.rawQueryString) > 32768) fail(400, 'INVALID_QUERY');
    // URLSearchParams replaces invalid UTF-8 with U+FFFD. Reject malformed
    // encoding instead of charging for a silently changed query or cursor.
    try {decodeURIComponent(event.rawQueryString.replace(/\+/g, ' '));} catch {fail(400, 'INVALID_QUERY');}
    const parsed = new URLSearchParams(event.rawQueryString), seen = new Set();
    params = Object.create(null);
    for (const [key, value] of parsed) {if (seen.has(key)) fail(400, 'INVALID_QUERY'); seen.add(key); params[key] = value;}
  }
  if (Object.keys(params).some(key => !['q', 'section', 'limit', 'filters', 'page_token'].includes(key)) || Object.values(params).some(value => typeof value !== 'string')) fail(400, 'INVALID_QUERY');
  // Normalize search text only; opaque cursors must remain byte-for-byte intact.
  const q = (params.q || '').normalize('NFC').trim().replace(/\s+/gu, ' '), section = params.section || '';
  if (q.length > 100 || !(params.q || '').isWellFormed() || /[\u0000-\u001f\u007f]/.test(params.q || '') || (q && section) || (!q && !Object.hasOwn(SECTIONS, section))) fail(400, 'INVALID_QUERY');
  if (section && !Object.hasOwn(SECTIONS, section)) fail(400, 'INVALID_QUERY');
  const limit = params.limit === undefined ? 24 : Number(params.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 24 || (params.limit !== undefined && !/^\d{1,2}$/.test(params.limit))) fail(400, 'INVALID_LIMIT');
  const filters = filtersFor(params.filters), token = params.page_token;
  if (token !== undefined && !tokenValid(token)) fail(400, 'CURSOR_INVALID');
  const mode = q ? 'search' : 'discovery', query = q || SECTIONS[section];
  const contextHash = hash([VERSION, 'channel3', mode, section, query, filters, limit]);
  const key = 'page#' + hash([VERSION, contextHash, token ?? null]);
  return {mode, query, filters, limit, token, contextHash, key, ttl: q ? SEARCH_TTL : DISCOVERY_TTL};
}
function sanitizeProduct(input) {
  if (!object(input) || typeof input.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(input.id) || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200) return null;
  const output = {id: input.id, title: input.title, description: cleanString(input.description, 2000)};
  output.brands = (Array.isArray(input.brands) ? input.brands : []).slice(0, 4).filter(object).map(brand => ({id: cleanString(brand.id, 200), name: cleanString(brand.name, 100)}));
  const image = input.images?.[0], url = safeUrl(image?.cleaned_url || image?.url, 'cdn.trychannel3.com');
  output.images = url ? [{url, alt_text: cleanString(image.alt_text, 200)}] : [];
  const category = object(input.category) ? input.category : {};
  output.category = {slug: cleanString(category.slug, 100), title: cleanString(category.title, 100), path: (Array.isArray(category.path) ? category.path : []).slice(0, 6).filter(object).map(part => ({slug: cleanString(part.slug, 100), title: cleanString(part.title, 100)}))};
  output.offers = (Array.isArray(input.offers) ? input.offers : []).slice(0, 8).filter(object).flatMap(offer => {
    const url = safeUrl(offer.url, 'buy.trychannel3.com'), price = offer.price;
    if (!url || !object(price) || typeof price.price !== 'number' || !Number.isFinite(price.price) || price.price < 0 || price.price > 1e9 || price.currency !== 'USD') return [];
    const clean = {url, domain: cleanString(offer.domain, 200), price: {price: price.price, currency: 'USD'}, availability: cleanString(offer.availability, 40), condition: cleanString(offer.condition, 40)};
    if (typeof price.compare_at_price === 'number' && Number.isFinite(price.compare_at_price) && price.compare_at_price >= 0 && price.compare_at_price <= 1e9) clean.price.compare_at_price = price.compare_at_price;
    return [clean];
  });
  const variants = object(input.variants) ? input.variants : {};
  output.variants = {
    options: (Array.isArray(variants.options) ? variants.options : []).slice(0, 4).filter(object).map(option => ({name: cleanString(option.name, 60), values: (Array.isArray(option.values) ? option.values : []).slice(0, 60).filter(object).map(value => ({label: cleanString(value.label, 80), exists: value.exists === true}))})),
    selected: (Array.isArray(variants.selected) ? variants.selected : []).slice(0, 8).filter(object).map(value => ({name: cleanString(value.name, 60), label: cleanString(value.label, 80)}))
  };
  output.key_features = (Array.isArray(input.key_features) ? input.key_features : []).slice(0, 8).filter(value => typeof value === 'string').map(value => value.slice(0, 200));
  return output;
}
function sanitizePage(input, request) {
  if (!object(input) || !Array.isArray(input.products) || input.products.length > request.limit) fail(502, 'UPSTREAM_INVALID');
  const token = input.next_page_token;
  if (token !== null && !tokenValid(token)) fail(502, 'UPSTREAM_INVALID');
  if (token !== null && token === request.token) fail(502, 'UPSTREAM_INVALID');
  const products = input.products.map(sanitizeProduct).filter(Boolean);
  return {products, next_page_token: token};
}
function validateCached(row, request, now) {
  if (row === undefined || row === null) return null;
  if (row.kind !== 'page' || row.version !== VERSION || row.contextHash !== request.contextHash || !object(row.payload) || row.payload.provider !== 'channel3' || Object.keys(row.payload).some(key => !['provider', 'data', 'fetchedAt', 'expiresAt'].includes(key))) fail(503, 'CACHE_UNAVAILABLE');
  const fetched = Date.parse(row.payload.fetchedAt), expires = Date.parse(row.payload.expiresAt);
  if (!Number.isFinite(fetched) || !Number.isFinite(expires) || fetched > now + 60_000 || expires <= fetched || expires - fetched > request.ttl || row.expiresAtMs !== expires) fail(503, 'CACHE_UNAVAILABLE');
  let sanitized;try {sanitized = sanitizePage(row.payload.data, request);} catch {fail(503, 'CACHE_UNAVAILABLE');}
  if (JSON.stringify(sanitized) !== JSON.stringify(row.payload.data) || Buffer.byteLength(JSON.stringify(row.payload)) > MAX_PAGE_BYTES) fail(503, 'CACHE_UNAVAILABLE');
  return expires > now ? row.payload : null;
}
function proxyResponse(statusCode, payload) {
  return {statusCode, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'https://anox.app', 'X-Content-Type-Options': 'nosniff'}, body: JSON.stringify(payload)};
}
function createHandler({store, upstream, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), metric = () => {}}) {
  const pending = new Map();
  const emit = name => {try {metric(name);} catch {}};
  async function load(request) {
    let chainExpires = now() + CURSOR_TTL, count = 0;
    if (request.token !== undefined) {
      const cursor = await store.get(cursorKey(request.contextHash, request.token));
      if (!cursor || cursor.kind !== 'cursor' || cursor.contextHash !== request.contextHash || !Number.isSafeInteger(cursor.expiresAtMs) || !Number.isSafeInteger(cursor.count) || cursor.count < 1 || cursor.count >= 500) fail(400, 'CURSOR_INVALID');
      if (cursor.expiresAtMs <= now()) fail(410, 'CURSOR_EXPIRED');
      chainExpires = cursor.expiresAtMs; count = cursor.count;
    }
    const requireActiveChain = () => {if (now() >= chainExpires) fail(410, 'CURSOR_EXPIRED');};
    const readPage = async () => {
      const row = await store.get(request.key);
      requireActiveChain();
      return validateCached(row, request, now());
    };
    const cached = await readPage();
    if (cached) {emit('cache_hit'); return cached;}
    emit('cache_miss');
    const owner = randomUUID();
    if (!await store.acquire(request.key, owner, now(), now() + LEASE_MS)) {
      requireActiveChain();
      emit('cache_contention');
      // A waiter never takes over in this invocation: failure needs an explicit retry.
      const waitUntil = now() + 6000;
      for (let attempt = 0; attempt < 20 && now() + 1800 <= waitUntil; attempt++) {
        await sleep(300);
        if (now() + 1500 > waitUntil) break;
        const ready = await readPage();
        if (ready) {emit('cache_hit'); return ready;}
      }
      fail(503, 'CACHE_BUSY');
    }
    try {
      // Recheck after the conditional lease; another invocation may have published
      // between our first read and lease acquisition.
      const raced = await readPage();
      if (raced) {emit('cache_hit'); return raced;}
      const input = {query: request.query, limit: request.limit};
      if (Object.keys(request.filters).length) input.filters = request.filters;
      if (request.token !== undefined) input.page_token = request.token;
      let data, rawCount;
      try {
        requireActiveChain();
        const raw = await upstream(input, {expiresAt: chainExpires}); data = sanitizePage(raw, request); rawCount = raw.products.length;
        if (!rawCount && data.next_page_token !== null) fail(502, 'UPSTREAM_INVALID');
      } catch (error) {emit('upstream_failure'); if (error instanceof SafeError && error.status === 410) throw error; fail(502, 'UPSTREAM_UNAVAILABLE');}
      const fetched = now(), expires = Math.min(fetched + request.ttl, chainExpires);
      if (expires <= fetched) fail(410, 'CURSOR_EXPIRED');
      data.products = data.products.slice(0, 500 - count);
      count += rawCount;
      if (count >= 500) data.next_page_token = null;
      const payload = {provider: 'channel3', data, fetchedAt: new Date(fetched).toISOString(), expiresAt: new Date(expires).toISOString()};
      if (Buffer.byteLength(JSON.stringify(payload)) > MAX_PAGE_BYTES) {emit('upstream_failure'); fail(502, 'UPSTREAM_INVALID');}
      const page = {kind: 'page', version: VERSION, contextHash: request.contextHash, expiresAtMs: expires, payload};
      const cursor = data.next_page_token === null ? null : {key: cursorKey(request.contextHash, data.next_page_token), value: {kind: 'cursor', contextHash: request.contextHash, expiresAtMs: chainExpires, count}};
      await store.publish(request.key, owner, page, cursor, now());
      return payload;
    } finally {
      try {await store.release(request.key, owner);} catch {emit('cache_error');}
    }
  }
  return async function handler(event) {
    try {
      const request = parseRequest(event);
      let work = pending.get(request.key);
      if (!work) {
        if (pending.size >= 100) fail(503, 'CACHE_BUSY');
        work = load(request); pending.set(request.key, work);
        const done = () => {if (pending.get(request.key) === work) pending.delete(request.key);};
        work.then(done, done);
      }
      return proxyResponse(200, await work);
    } catch (error) {
      if (error instanceof SafeError) return proxyResponse(error.status, {error: error.code});
      emit('cache_error'); return proxyResponse(503, {error: 'CACHE_UNAVAILABLE'});
    }
  };
}
function createDynamoStore({client, commands, table}) {
  const {GetItemCommand, PutItemCommand, DeleteItemCommand, TransactWriteItemsCommand} = commands;
  const send = command => client.send(command, {abortSignal: AbortSignal.timeout(1500)});
  const key = pk => ({pk: {S: pk}});
  const item = (pk, value) => ({pk: {S: pk}, value: {S: JSON.stringify(value)}, expiresAt: {N: String(Math.ceil(value.expiresAtMs / 1000))}});
  return {
    async get(pk) {
      const result = await send(new GetItemCommand({TableName: table, Key: key(pk), ConsistentRead: true}));
      if (!result.Item) return undefined;
      if (typeof result.Item.value?.S !== 'string') throw Error('CACHE_INVALID');
      return JSON.parse(result.Item.value.S);
    },
    async acquire(pk, owner, now, until) {
      try {
        await send(new PutItemCommand({TableName: table, Item: {...key('lease#' + pk), owner: {S: owner}, leaseUntil: {N: String(until)}, expiresAt: {N: String(Math.ceil(until / 1000))}},
          ConditionExpression: 'attribute_not_exists(pk) OR leaseUntil <= :now', ExpressionAttributeValues: {':now': {N: String(now)}}}));
        return true;
      } catch (error) {if (error.name === 'ConditionalCheckFailedException') return false; throw error;}
    },
    async publish(pk, owner, page, cursor, now) {
      const writes = [{Put: {TableName: table, Item: item(pk, page)}}];
      if (cursor) writes.push({Put: {TableName: table, Item: item(cursor.key, cursor.value)}});
      writes.push({Delete: {TableName: table, Key: key('lease#' + pk), ConditionExpression: '#owner = :owner AND leaseUntil > :now',
        ExpressionAttributeNames: {'#owner': 'owner'}, ExpressionAttributeValues: {':owner': {S: owner}, ':now': {N: String(now)}}}});
      await send(new TransactWriteItemsCommand({ClientRequestToken: owner, TransactItems: writes}));
    },
    async release(pk, owner) {
      try {await send(new DeleteItemCommand({TableName: table, Key: key('lease#' + pk), ConditionExpression: '#owner = :owner', ExpressionAttributeNames: {'#owner': 'owner'}, ExpressionAttributeValues: {':owner': {S: owner}}}));}
      catch (error) {if (error.name !== 'ConditionalCheckFailedException') throw error;}
    }
  };
}
function createUpstream({fetch: transport = globalThis.fetch, getSecret, now = Date.now, timeoutMs = 10_000, metric = () => {}}) {
  let secret = '', secretUntil = 0, secretPending = null;
  async function apiKey(signal) {
    if (secret && secretUntil > now()) return secret;
    if (!secretPending) {
      secretPending = (async () => {
        const raw = await getSecret(signal);
        let parsed; try {parsed = JSON.parse(raw);} catch {}
        const value = object(parsed) ? parsed.apiKey || parsed.api_key || parsed.key : raw;
        if (typeof value !== 'string' || !value.length || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) fail(502, 'UPSTREAM_UNAVAILABLE');
        secret = value; secretUntil = now() + 300_000; return secret;
      })();
      secretPending.then(() => {secretPending = null;}, () => {secretPending = null;});
    }
    return secretPending;
  }
  return async (input, {expiresAt} = {}) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      const key = await apiKey(controller.signal);
      controller.signal.throwIfAborted();
      if (expiresAt !== undefined && now() >= expiresAt) fail(410, 'CURSOR_EXPIRED');
      try {metric('upstream_request');} catch {}
      response = await transport('https://api.trychannel3.com/v1/search', {method: 'POST', headers: {'Content-Type': 'application/json', 'x-api-key': key}, body: JSON.stringify(input), signal: controller.signal, redirect: 'error'});
      if (!response.ok) {
        await response.body?.cancel();
        if (input.page_token !== undefined && [400, 404, 410, 422].includes(response.status)) fail(410, 'CURSOR_INVALID');
        fail(502, 'UPSTREAM_UNAVAILABLE');
      }
      if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') || '') || Number(response.headers.get('content-length')) > MAX_UPSTREAM_BYTES) {
        await response.body?.cancel(); fail(502, 'UPSTREAM_INVALID');
      }
      const reader = response.body?.getReader(); if (!reader) fail(502, 'UPSTREAM_INVALID');
      const decoder = new TextDecoder('utf-8', {fatal: true}); let text = '', bytes = 0;
      try {
        for (;;) {
          const {done, value} = await reader.read(); if (done) break;
          bytes += value.byteLength; if (bytes > MAX_UPSTREAM_BYTES) fail(502, 'UPSTREAM_INVALID');
          text += decoder.decode(value, {stream: true});
        }
        text += decoder.decode(); return JSON.parse(text);
      } catch (error) {await reader.cancel().catch(() => {}); throw error;}
    } catch (error) {if (error instanceof SafeError) throw error; fail(502, 'UPSTREAM_UNAVAILABLE');}
    finally {clearTimeout(timer); controller.abort();}
  };
}
function createMetric({log = line => console.log(line), now = Date.now} = {}) {
  const names = new Set(['cache_hit', 'cache_miss', 'upstream_request', 'upstream_failure', 'cache_contention', 'cache_error']);
  return name => {
    if (!names.has(name)) return;
    log(JSON.stringify({_aws: {Timestamp: now(), CloudWatchMetrics: [{Namespace: 'AnoX/Catalog', Dimensions: [['Service']], Metrics: [{Name: name, Unit: 'Count'}]}]}, Service: 'Channel3Catalog', event: name, [name]: 1}));
  };
}
let runtimeHandler;
async function handler(event) {
  if (!runtimeHandler) {
    // SDK clients are reused by the warm runtime. Secret values are resolved only
    // inside this deployed application and never included in source or responses.
    const dynamo = require('@aws-sdk/client-dynamodb');
    const secrets = require('@aws-sdk/client-secrets-manager');
    const config = {region: process.env.AWS_REGION || 'us-east-2', maxAttempts: 2, requestHandler: {connectionTimeout: 1000, requestTimeout: 1500}};
    const client = new dynamo.DynamoDBClient(config), secretClient = new secrets.SecretsManagerClient(config);
    const table = process.env.CACHE_TABLE, secretId = process.env.CHANNEL3_SECRET_ID;
    if (!table || !secretId) return proxyResponse(503, {error: 'CACHE_UNAVAILABLE'});
    const metric = createMetric();
    runtimeHandler = createHandler({store: createDynamoStore({client, commands: dynamo, table}), metric,
      upstream: createUpstream({metric, getSecret: async signal => (await secretClient.send(new secrets.GetSecretValueCommand({SecretId: secretId}), {abortSignal: signal})).SecretString})});
  }
  return runtimeHandler(event);
}
module.exports = {handler, createHandler, createUpstream, createDynamoStore, createMetric};
