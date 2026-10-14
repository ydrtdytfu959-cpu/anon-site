const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function adapter(fetch = async () => { throw Error('Unexpected network request'); }) {
  const context = { module: { exports: {} }, URL, URLSearchParams, AbortController, TextDecoder, setTimeout, clearTimeout, fetch };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../catalog-live.js'), 'utf8'), context);
  return context.module.exports;
}
const nike = (patch = {}) => ({ id: 'SKU_1', title: 'Running shoe', brand: 'Nike', currency: 'USD', price: 120,
  productUrl: 'https://www.nike.com/t/shoe', image: 'https://static.nike.com/image.jpg', ...patch });

test('Nike rejects missing currency, non-Nike brands, malformed identity and unsafe merchant URLs', () => {
  const api = adapter();
  for (const patch of [{ currency: '' }, { currency: 'EUR' }, { brand: '' }, { brand: 'Other' }, { id: '' },
    { id: 'bad id' }, { title: '' }, { title: 'x'.repeat(201) }, { productUrl: 'https://example.com/shoe' },
    { productUrl: 'https://www.nike.com:444/shoe' }, { updatedAt: '2100-01-01T00:00:00Z' },
    { salePrice: 90, saleCurrency: 'EUR' }]) assert.equal(api.normalizeNikeProduct(nike(patch)), null, JSON.stringify(patch));
});

test('Nike treats all prices as exact USD major units and never invents stock, weight or verification', () => {
  const api = adapter(), p = api.normalizeNikeProduct(nike({ price: 12000, availability: 'in stock' }));
  assert.equal(p.priceCents, 1200000);
  assert.equal(p.slug, 'SKU_1');
  assert.equal(p.stock, 0);
  assert.equal(p.weightGrams, 0);
  assert.equal(p.updatedAt, null);
  assert.equal(p.variantDetailsKnown, false);
  assert.equal(p.source.availabilityVerifiedAt, null);
  assert.equal(p.purchasable, false);
  for (const price of ['USD 12', '12.001', -1, 1000001, { amount: 12 }]) assert.equal(api.normalizeNikeProduct(nike({ price })), null);
});

test('Nike caps media, keeps only distinct valid variants and preserves known inventory', () => {
  const p = adapter().normalizeNikeProduct(nike({ images: Array.from({ length: 12 }, (_, i) => `https://static.nike.com/${i}.jpg`),
    variants: [{ color: 'Blue', size: '9', stock: 2 }, { color: 'Blue', size: '9', stock: 5 }, { color: '', size: '10', stock: 4 }] }));
  assert.equal(p.media.length, 8);
  assert.equal(p.variants.length, 1);
  assert.equal(p.stock, 2);
});

test('Nike pagination rejects oversized pages, nonprogressing offsets and malformed payloads', () => {
  const api = adapter();
  assert.throws(() => api.parseCatalogPage({ items: [nike(), nike()] }, { limit: 1 }), /catalog_record_limit/);
  assert.throws(() => api.parseCatalogPage({ items: [nike()], nextOffset: 0 }), /catalog_pagination/);
  assert.throws(() => api.parseCatalogPage({ items: [], nextOffset: 24 }), /catalog_pagination/);
  assert.throws(() => api.parseCatalogPage({ arbitrary: [] }), /catalog_payload/);
  for (const limit of [0, 101, 1.5]) assert.throws(() => api.buildCatalogUrl({ limit }), /catalog_options/);
});

test('canonical Nike lookup rejects identity substitution', async () => {
  const api = adapter(async () => new Response(JSON.stringify({ product: nike({ id: 'OTHER' }) }), { headers: { 'content-type': 'application/json' } }));
  await assert.rejects(api.getProduct('SKU_1'), /catalog_identity/);
});

test('transport omits credentials, disables redirects and enforces JSON MIME and streaming byte limits', async () => {
  let options;
  let api = adapter(async (_url, init) => { options = init; return new Response(JSON.stringify({ items: [nike()] }), { headers: { 'content-type': 'application/json' } }); });
  assert.equal((await api.fetchPage()).items.length, 1);
  assert.equal(options.redirect, 'error');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.referrerPolicy, 'no-referrer');
  api = adapter(async () => new Response('{}', { headers: { 'content-type': 'text/html' } }));
  await assert.rejects(api.fetchPage(), /catalog_payload_limit/);
  api = adapter(async () => new Response(' '.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }));
  await assert.rejects(api.fetchPage(), /catalog_payload_limit/);
});

test('aborted calls perform no network request and HTTP429 cooldown does not retry', async () => {
  let requests = 0;
  const api = adapter(async () => { requests++; return new Response('', { status: 429, headers: { 'retry-after': '5' } }); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.fetchPage({ signal: controller.signal }), /catalog_aborted/);
  assert.equal(requests, 0);
  await assert.rejects(api.fetchPage(), /catalog_rate_limited/);
  await assert.rejects(api.fetchPage(), /catalog_rate_limited/);
  assert.equal(requests, 1);
});
