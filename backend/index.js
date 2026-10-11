'use strict';
const {createHash, randomUUID} = require('node:crypto');

const VERSION = 1;
const SEARCH_TTL = 300_000, DISCOVERY_TTL = 600_000, CURSOR_TTL = 1_800_000;
const DETAIL_TTL = 30_000, PRESENTATION_TTL = 3_600_000, MAX_DETAIL_BYTES = 256 * 1024;
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
const detailId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const optionText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && value.isWellFormed() && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
function detailOptions(input = {}) {
  if (!object(input) || Object.keys(input).length > 8) fail(400, 'INVALID_OPTIONS');
  const output = {};
  for (const name of Object.keys(input).sort()) {
    if (!optionText(name, 60) || ['__proto__', 'constructor', 'prototype'].includes(name) || !optionText(input[name], 80)) fail(400, 'INVALID_OPTIONS');
    output[name] = input[name];
  }
  return output;
}
function parseDetail(event, startedAt) {
  let productId, options, internal = false;
  if (Object.hasOwn(event, 'operation')) {
    if (event.operation !== 'commerce.product' || Object.keys(event).some(key => !['operation', 'productId', 'options'].includes(key))) fail(400, 'INVALID_OPERATION');
    internal = true; productId = event.productId; options = detailOptions(event.options);
  } else {
    if (event?.requestContext?.http?.method !== 'GET') fail(405, 'METHOD_NOT_ALLOWED');
    productId = /^\/catalog\/channel3\/products\/([A-Za-z0-9_-]{1,80})$/.exec(event.rawPath)?.[1];
    let params = event.queryStringParameters || {};
    if (typeof event.rawQueryString === 'string') {
      if (Buffer.byteLength(event.rawQueryString) > 4096) fail(400, 'INVALID_OPTIONS');
      try {decodeURIComponent(event.rawQueryString.replace(/\+/g, ' '));} catch {fail(400, 'INVALID_OPTIONS');}
      params = Object.create(null);
      for (const [key, value] of new URLSearchParams(event.rawQueryString)) {
        if (Object.hasOwn(params, key)) fail(400, 'INVALID_OPTIONS');
        params[key] = value;
      }
    }
    if (!object(params)) fail(400, 'INVALID_OPTIONS');
    const selected = Object.create(null);
    for (const [key, value] of Object.entries(params)) {
      if (!key.startsWith('option_')) fail(400, 'INVALID_OPTIONS');
      selected[key.slice(7)] = value;
    }
    options = detailOptions(selected);
  }
  if (!detailId(productId)) fail(400, 'INVALID_PRODUCT');
  const contextHash = hash([VERSION, 'channel3-detail', productId, options]);
  return {mode:'detail', productId, options, internal, startedAt, contextHash, key:'detail#' + contextHash, presentationKey:'presentation#' + contextHash};
}
function detailText(value, max, required = false) {
  if (value === undefined || value === null) {if (required) fail(502, 'UPSTREAM_INVALID'); return null;}
  if (typeof value !== 'string' || value.length > max || !value.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || required && !value.trim()) fail(502, 'UPSTREAM_INVALID');
  return value;
}
function detailArray(value, max) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) fail(502, 'UPSTREAM_INVALID');
  return value;
}
const availability = value => ['InStock', 'OutOfStock'].includes(value) ? value : null;
const usdAmount = value => typeof value === 'number' && value >= 0 && value <= 1e6 && /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(String(value)) ? value : null;
function detailDimensions(value) {
  if (!object(value)) return null;
  return Object.fromEntries(['length', 'width', 'height', 'weight'].map(name => {
    const field = value[name], units = name === 'weight' ? ['mg', 'g', 'kg', 'oz', 'lb'] : ['mm', 'cm', 'm', 'in', 'ft'];
    return [name, object(field) && typeof field.number === 'number' && Number.isFinite(field.number) && field.number > 0 && field.number <= 1e9 && units.includes(field.unit) ? {number:field.number, unit:field.unit} : null];
  }));
}
function sanitizeDetail(input, productId) {
  if (!object(input) || input.id !== productId) fail(502, 'UPSTREAM_INVALID');
  const output = {id:productId, title:detailText(input.title, 200, true), description:detailText(input.description, 60000)};
  output.brands = detailArray(input.brands, 16).filter(object).map(brand => ({id:detailText(brand.id, 200, true), name:detailText(brand.name, 100, true)}));
  output.images = detailArray(input.images, 64).filter(object).flatMap(image => {
    const url = safeUrl(image.url, 'cdn.trychannel3.com');
    return url ? [{url, cleaned_url:safeUrl(image.cleaned_url, 'cdn.trychannel3.com') || null, alt_text:detailText(image.alt_text, 500), is_main_image:image.is_main_image === true, shot_type:detailText(image.shot_type, 40)}] : [];
  });
  const category = input.category;
  output.category = object(category) ? {slug:detailText(category.slug, 100), title:detailText(category.title, 100), path:detailArray(category.path, 16).filter(object).map(part => ({slug:detailText(part.slug, 100), title:detailText(part.title, 100)})), has_children:typeof category.has_children === 'boolean' ? category.has_children : null} : null;
  output.gender = ['male', 'female'].includes(input.gender) ? input.gender : null;
  output.age = ['newborn', 'infant', 'toddler', 'kids', 'adult'].includes(input.age) ? input.age : null;
  for (const name of ['materials', 'key_features']) output[name] = detailArray(input[name], 64).map(value => detailText(value, 2000, true));
  const attributes = input.structured_attributes ?? {};
  if (!object(attributes) || Object.keys(attributes).length > 64) fail(502, 'UPSTREAM_INVALID');
  output.structured_attributes = Object.create(null);
  for (const [name, values] of Object.entries(attributes)) {
    if (!optionText(name, 80) || ['__proto__', 'constructor', 'prototype'].includes(name)) fail(502, 'UPSTREAM_INVALID');
    output.structured_attributes[name] = detailArray(values, 64).map(value => detailText(value, 1000, true));
  }
  output.offers = detailArray(input.offers, 64).filter(object).flatMap(offer => {
    const url = safeUrl(offer.url, 'buy.trychannel3.com'), domain = typeof offer.domain === 'string' ? offer.domain.toLowerCase() : '';
    if (!url || domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) return [];
    const amount = offer.price?.currency === 'USD' ? usdAmount(offer.price.price) : null;
    return [{url, domain, price:amount === null ? null : {price:amount, currency:'USD', compare_at_price:usdAmount(offer.price.compare_at_price)}, availability:availability(offer.availability), condition:['new', 'used'].includes(offer.condition) ? offer.condition : null,
      max_commission_rate:typeof offer.max_commission_rate === 'number' && offer.max_commission_rate >= 0 && offer.max_commission_rate <= 1 ? offer.max_commission_rate : null, dimensions:detailDimensions(offer.dimensions)}];
  });
  output.variants = null;
  if (input.variants !== undefined && input.variants !== null) {
    if (!object(input.variants)) fail(502, 'UPSTREAM_INVALID');
    const names = new Set();
    const options = detailArray(input.variants.options, 8).map(option => {
      if (!object(option) || !optionText(option.name, 60) || names.has(option.name) || ['__proto__', 'constructor', 'prototype'].includes(option.name)) fail(502, 'UPSTREAM_INVALID');
      names.add(option.name); const labels = new Set();
      return {name:option.name, values:detailArray(option.values, 120).map(value => {
        if (!object(value) || !optionText(value.label, 80) || labels.has(value.label) || typeof value.exists !== 'boolean') fail(502, 'UPSTREAM_INVALID');
        labels.add(value.label);
        return {label:value.label, exists:value.exists, available:availability(value.available), thumbnail_url:safeUrl(value.thumbnail_url, 'cdn.trychannel3.com') || null, product_id:detailId(value.product_id) ? value.product_id : null};
      })};
    });
    const selectedNames = new Set();
    const selected = detailArray(input.variants.selected, 8).map(value => {
      const option = object(value) && options.find(option => option.name === value.name);
      if (!option || selectedNames.has(value.name) || !option.values.some(entry => entry.label === value.label)) fail(502, 'UPSTREAM_INVALID');
      selectedNames.add(value.name); return {name:value.name, label:value.label};
    });
    output.variants = {options, selected};
  }
  if (Buffer.byteLength(JSON.stringify(output)) > MAX_DETAIL_BYTES) fail(502, 'UPSTREAM_INVALID');
  return output;
}
function mismatches(product, options) {
  const effective = new Map((product.variants?.selected || []).map(value => [value.name, value.label]));
  return Object.entries(options).filter(([name, label]) => effective.get(name) !== label).map(([name, requested]) => ({name, requested, effective:effective.get(name) ?? null}));
}
function presentation(product) {
  const result = structuredClone(product); result.offers = [];
  for (const option of result.variants?.options || []) for (const value of option.values) value.available = null;
  return result;
}
function validateDetailRow(row, request, kind, now) {
  if (row == null) return null;
  try {
    const payload = row.payload, ttl = kind === 'detail' ? DETAIL_TTL : PRESENTATION_TTL;
    if (row.kind !== kind || row.version !== VERSION || row.contextHash !== request.contextHash || !object(payload) || Object.keys(payload).some(key => !['provider', 'data', 'fetchedAt', 'expiresAt', 'status', 'error', 'selectionMismatch'].includes(key)) || payload.provider !== 'channel3' || !object(payload.data) || Object.keys(payload.data).length !== 1) throw Error();
    const fetched = Date.parse(payload.fetchedAt), expires = Date.parse(payload.expiresAt);
    if (!Number.isFinite(fetched) || !Number.isFinite(expires) || fetched > now + 60000 || expires - fetched !== ttl || row.expiresAtMs !== expires) throw Error();
    const product = sanitizeDetail(payload.data.product, request.productId);
    if (JSON.stringify(product) !== JSON.stringify(payload.data.product) || JSON.stringify(mismatches(product, request.options)) !== JSON.stringify(payload.selectionMismatch) || Buffer.byteLength(JSON.stringify(payload)) > MAX_DETAIL_BYTES) throw Error();
    if (kind === 'presentation' && (payload.status !== 'presentation_only' || payload.error !== 'DETAIL_REFRESH_UNAVAILABLE' || JSON.stringify(presentation(product)) !== JSON.stringify(product))) throw Error();
    if (kind === 'detail' && (payload.status !== 'fresh' || payload.error !== null)) throw Error();
    return expires > now && (kind === 'presentation' || fetched > request.startedAt) ? payload : null;
  } catch {fail(503, 'CACHE_UNAVAILABLE');}
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
function createHandler({store, upstream, upstreamDetail = upstream?.detail, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), metric = () => {}}) {
  const pending = new Map(); let sequence = 0;
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
      } catch (error) {emit('upstream_failure'); if (error instanceof SafeError && [410, 429, 503].includes(error.status)) throw error; fail(502, 'UPSTREAM_UNAVAILABLE');}
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
  async function loadDetail(request, fetched) {
    const read = async () => validateDetailRow(await store.get(request.key), request, 'detail', now());
    const exchanged = await read();
    if (exchanged) {emit('detail_coalesced'); return exchanged;}
    const owner = randomUUID();
    if (!await store.acquire(request.key, owner, now(), now() + LEASE_MS)) {
      emit('cache_contention'); const until = now() + 6000;
      for (let attempt = 0; attempt < 20 && now() + 1800 <= until; attempt++) {
        await sleep(300); if (now() + 1500 > until) break;
        const ready = await read(); if (ready) {emit('detail_coalesced'); return ready;}
      }
      fail(503, 'CACHE_BUSY');
    }
    try {
      const raced = await read(); if (raced) {emit('detail_coalesced'); return raced;}
      let product;
      try {product = sanitizeDetail(await upstreamDetail({productId:request.productId, options:request.options}), request.productId);}
      catch (error) {
        emit('upstream_failure');
        if (error?.code === 'PRODUCT_NOT_FOUND') fail(404, 'PRODUCT_NOT_FOUND');
        if (['UPSTREAM_BUDGET_EXCEEDED', 'UPSTREAM_RATE_LIMITED', 'UPSTREAM_BUDGET_UNAVAILABLE'].includes(error?.code)) fail(error.code === 'UPSTREAM_BUDGET_UNAVAILABLE' ? 503 : 429, error.code);
        fail(503, 'DETAIL_REFRESH_UNAVAILABLE');
      }
      // Stop admitting local waiters when the upstream result is complete, even
      // if its durable publication is still pending. A later view needs new data.
      fetched();
      const fetchedAt = now(), selectionMismatch = mismatches(product, request.options);
      const payload = {provider:'channel3', data:{product}, fetchedAt:new Date(fetchedAt).toISOString(), expiresAt:new Date(fetchedAt + DETAIL_TTL).toISOString(), status:'fresh', error:null, selectionMismatch};
      if (Buffer.byteLength(JSON.stringify(payload)) > MAX_DETAIL_BYTES) fail(503, 'DETAIL_REFRESH_UNAVAILABLE');
      const fallback = {...payload, data:{product:presentation(product)}, expiresAt:new Date(fetchedAt + PRESENTATION_TTL).toISOString(), status:'presentation_only', error:'DETAIL_REFRESH_UNAVAILABLE'};
      const row = {kind:'detail', version:VERSION, contextHash:request.contextHash, expiresAtMs:fetchedAt + DETAIL_TTL, payload};
      await store.publish(request.key, owner, row, null, now(), [{key:request.presentationKey, value:{...row, kind:'presentation', expiresAtMs:fetchedAt + PRESENTATION_TTL, payload:fallback}}]);
      emit('detail_fresh'); return payload;
    } finally {try {await store.release(request.key, owner);} catch {emit('cache_error');}}
  }
  return async function handler(event) {
    let request;
    try {
      if (!object(event)) fail(400, 'INVALID_REQUEST');
      request = Object.hasOwn(event, 'operation') || event.rawPath?.startsWith('/catalog/channel3/products') ? parseDetail(event, now()) : parseRequest(event);
      request.order = ++sequence;
      let entry = pending.get(request.key);
      while (request.mode === 'detail' && entry?.fetched) {
        await entry.work.catch(() => {});
        entry = pending.get(request.key);
      }
      if (!entry) {
        if (pending.size >= 100) fail(503, 'CACHE_BUSY');
        const created = {fetched:false};
        created.work = request.mode === 'detail' ? loadDetail(request, () => {created.fetched = true; created.fetchedOrder = ++sequence;}) : load(request);
        pending.set(request.key, created); entry = created;
        const done = () => {if (pending.get(request.key) === created) pending.delete(request.key);};
        created.work.then(done, done);
      }
      let payload;
      try {
        payload = await entry.work;
        // The first waiter's timestamp cannot confer freshness on a later one.
        // A local sequence also distinguishes requests within one clock tick.
        if (request.mode === 'detail' && !(entry.fetchedOrder > request.order || Date.parse(payload.fetchedAt) > request.startedAt)) fail(503, 'CACHE_BUSY');
      }
      catch (error) {
        if (request.mode !== 'detail' || request.internal || !['DETAIL_REFRESH_UNAVAILABLE', 'CACHE_BUSY', 'UPSTREAM_BUDGET_EXCEEDED', 'UPSTREAM_RATE_LIMITED', 'UPSTREAM_BUDGET_UNAVAILABLE'].includes(error?.code)) throw error;
        payload = validateDetailRow(await store.get(request.presentationKey), request, 'presentation', now());
        if (!payload) throw error;
        emit('presentation_fallback');
      }
      return request.internal ? payload : proxyResponse(200, payload);
    } catch (error) {
      const status = error instanceof SafeError ? error.status : 503, code = error instanceof SafeError ? error.code : 'CACHE_UNAVAILABLE';
      if (!(error instanceof SafeError)) emit('cache_error');
      return request?.internal ? {statusCode:status, error:code} : proxyResponse(status, {error:code});
    }
  };
}
function createBudget({store, now = Date.now, paidDailyLimit = 1000, detailDailyLimit = 5000, perSecondLimit = 5}) {
  for (const limit of [paidDailyLimit, detailDailyLimit]) if (!Number.isSafeInteger(limit) || limit < 0 || limit > 10000) throw Error('INVALID_BUDGET_CONFIG');
  if (!Number.isSafeInteger(perSecondLimit) || perSecondLimit < 1 || perSecondLimit > 10 || typeof store?.reserve !== 'function') throw Error('INVALID_BUDGET_CONFIG');
  return async kind => {
    if (!['paid', 'detail'].includes(kind)) fail(503, 'UPSTREAM_BUDGET_UNAVAILABLE');
    const time = now(), day = new Date(time).toISOString().slice(0, 10), second = Math.floor(time / 1000);
    try {
      await store.reserve({dailyKey:`budget#${day}#${kind}`, rateKey:`rate#${second}`, dailyLimit:kind === 'paid' ? paidDailyLimit : detailDailyLimit, rateLimit:perSecondLimit,
        expiresAt:Math.floor(Date.parse(day + 'T00:00:00.000Z') / 1000) + 172800, rateExpiresAt:second + 120});
      return {validUntil:(second + 1) * 1000};
    } catch (error) {
      if (error instanceof SafeError) throw error;
      fail(503, 'UPSTREAM_BUDGET_UNAVAILABLE');
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
    async publish(pk, owner, page, cursor, now, extra = []) {
      const writes = [{Put: {TableName: table, Item: item(pk, page)}}];
      if (cursor) writes.push({Put: {TableName: table, Item: item(cursor.key, cursor.value)}});
      for (const row of extra) writes.push({Put:{TableName:table, Item:item(row.key, row.value)}});
      writes.push({Delete: {TableName: table, Key: key('lease#' + pk), ConditionExpression: '#owner = :owner AND leaseUntil > :now',
        ExpressionAttributeNames: {'#owner': 'owner'}, ExpressionAttributeValues: {':owner': {S: owner}, ':now': {N: String(now)}}}});
      await send(new TransactWriteItemsCommand({ClientRequestToken: owner, TransactItems: writes}));
    },
    async reserve({dailyKey, rateKey, dailyLimit, rateLimit, expiresAt, rateExpiresAt = expiresAt}) {
      const counter = (pk, limit, expires) => ({Update:{TableName:table, Key:key(pk), UpdateExpression:'SET expiresAt = :expires ADD #used :one',
        ConditionExpression:':limit > :zero AND (attribute_not_exists(#used) OR #used < :limit)', ExpressionAttributeNames:{'#used':'used'},
        ExpressionAttributeValues:{':expires':{N:String(expires)}, ':one':{N:'1'}, ':zero':{N:'0'}, ':limit':{N:String(limit)}}}});
      try {await send(new TransactWriteItemsCommand({ClientRequestToken:randomUUID(), TransactItems:[counter(dailyKey, dailyLimit, expiresAt), counter(rateKey, rateLimit, rateExpiresAt)]}));}
      catch (error) {
        if (error.name === 'TransactionCanceledException') {
          if (error.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed') fail(429, 'UPSTREAM_BUDGET_EXCEEDED');
          if (error.CancellationReasons?.[1]?.Code === 'ConditionalCheckFailed') fail(429, 'UPSTREAM_RATE_LIMITED');
        }
        fail(503, 'UPSTREAM_BUDGET_UNAVAILABLE');
      }
    },
    async release(pk, owner) {
      try {await send(new DeleteItemCommand({TableName: table, Key: key('lease#' + pk), ConditionExpression: '#owner = :owner', ExpressionAttributeNames: {'#owner': 'owner'}, ExpressionAttributeValues: {':owner': {S: owner}}}));}
      catch (error) {if (error.name !== 'ConditionalCheckFailedException') throw error;}
    }
  };
}
function createUpstream({fetch: transport = globalThis.fetch, getSecret, reserve = async () => {}, now = Date.now, timeoutMs = 10_000, metric = () => {}}) {
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
  async function request(input, {expiresAt} = {}, detail = false) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      const key = await apiKey(controller.signal);
      controller.signal.throwIfAborted();
      if (expiresAt !== undefined && now() >= expiresAt) fail(410, 'CURSOR_EXPIRED');
      try {
        const reservation = await reserve(detail ? 'detail' : 'paid');
        if (reservation?.validUntil !== undefined && now() >= reservation.validUntil) fail(429, 'UPSTREAM_RATE_LIMITED');
      }
      catch (error) {
        const code = ['UPSTREAM_BUDGET_EXCEEDED', 'UPSTREAM_RATE_LIMITED'].includes(error?.code) ? error.code : 'UPSTREAM_BUDGET_UNAVAILABLE';
        try {metric(code === 'UPSTREAM_BUDGET_EXCEEDED' ? 'budget_exceeded' : code === 'UPSTREAM_RATE_LIMITED' ? 'rate_limited' : 'budget_error');} catch {}
        fail(code === 'UPSTREAM_BUDGET_UNAVAILABLE' ? 503 : 429, code);
      }
      controller.signal.throwIfAborted();
      if (expiresAt !== undefined && now() >= expiresAt) fail(410, 'CURSOR_EXPIRED');
      let url = 'https://api.trychannel3.com/v1/search';
      const init = {method:detail ? 'GET' : 'POST', headers:{'Content-Type':'application/json', 'x-api-key':key}, signal:controller.signal, redirect:'error'};
      if (detail) {
        const params = new URLSearchParams({country:'US', currency:'USD', language:'en'});
        for (const [name, value] of Object.entries(input.options)) params.set('option_' + name, value);
        url = 'https://api.trychannel3.com/v1/products/' + encodeURIComponent(input.productId) + '?' + params.toString();
      } else init.body = JSON.stringify(input);
      try {metric('upstream_request'); metric(detail ? 'free_detail_request' : 'paid_search_request');} catch {}
      response = await transport(url, init);
      if (!response.ok) {
        await response.body?.cancel();
        if (detail && response.status === 404) fail(404, 'PRODUCT_NOT_FOUND');
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
  }
  const search = (input, options) => request(input, options);
  search.detail = input => {
    if (!detailId(input?.productId)) fail(400, 'INVALID_PRODUCT');
    return request({productId:input.productId, options:detailOptions(input.options)}, {}, true);
  };
  return search;
}
function createMetric({log = line => console.log(line), now = Date.now} = {}) {
  const names = new Set(['cache_hit', 'cache_miss', 'upstream_request', 'upstream_failure', 'cache_contention', 'cache_error', 'paid_search_request', 'free_detail_request', 'detail_fresh', 'detail_coalesced', 'presentation_fallback', 'budget_exceeded', 'rate_limited', 'budget_error']);
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
    const metric = createMetric(), store = createDynamoStore({client, commands:dynamo, table});
    let reserve;
    try {reserve = createBudget({store, paidDailyLimit:Number(process.env.PAID_DAILY_LIMIT ?? 1000), detailDailyLimit:Number(process.env.DETAIL_DAILY_LIMIT ?? 5000), perSecondLimit:Number(process.env.UPSTREAM_PER_SECOND_LIMIT ?? 5)});}
    catch {return proxyResponse(503, {error:'UPSTREAM_BUDGET_UNAVAILABLE'});}
    runtimeHandler = createHandler({store, metric,
      upstream:createUpstream({metric, reserve, getSecret:async signal => (await secretClient.send(new secrets.GetSecretValueCommand({SecretId:secretId}), {abortSignal:signal})).SecretString})});
  }
  return runtimeHandler(event);
}
module.exports = {handler, createHandler, createUpstream, createDynamoStore, createMetric, createBudget};
