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
const product = (id = 'p1', patch = {}) => ({ id, title: 'Running shoe', brands: [{ id: 'b1', name: 'Brand' }],
  images: [{ cleaned_url: 'https://cdn.trychannel3.com/clean.jpg', url: 'https://cdn.trychannel3.com/main.jpg' }],
  offers: [{ url: 'https://buy.trychannel3.com/p1', domain: 'shop.com', availability: 'InStock', condition: 'new', price: { price: 45.99, currency: 'USD' } }], ...patch });
function envelope(products = [product()], next = null, patch = {}) {
  const now = Date.now();
  return { provider: 'channel3', data: { products, next_page_token: next }, fetchedAt: new Date(now - 60000).toISOString(), expiresAt: new Date(now + 240000).toISOString(), ...patch };
}

test('discovery and query requests stay distinct and opaque cursors round-trip unmodified', () => {
  const api = adapter();
  let url = new URL(api.buildChannel3Url({ section: 'shoes', limit: 24 }));
  assert.equal(url.searchParams.get('section'), 'shoes');
  assert.equal(url.searchParams.has('q'), false);
  assert.equal(url.searchParams.get('limit'), '24');
  url = new URL(api.buildChannel3Url());
  assert.equal(url.searchParams.get('section'), 'featured');
  const cursor = ' token +/=_%?&#العربية ';
  url = new URL(api.buildChannel3Url({ q: ' black shoes ', cursor, filters: { availability: ['OutOfStock', 'InStock'] } }));
  assert.equal(url.searchParams.get('q'), 'black shoes');
  assert.equal(url.searchParams.has('section'), false);
  assert.equal(url.searchParams.get('page_token'), cursor);
  assert.deepEqual(JSON.parse(url.searchParams.get('filters')), { availability: ['InStock', 'OutOfStock'] });
  assert.equal(url.searchParams.has('offset'), false);
});

test('adapter rejects invalid context, query, limits and cursor before transport', () => {
  const api = adapter();
  for (const options of [{ limit: 0 }, { limit: 25 }, { limit: 1.5 }, { q: 'x'.repeat(101) }, { q: 1 }, { section: 'unknown' }, { q: 'shoe', section: 'men' }]) {
    assert.throws(() => api.buildChannel3Url(options), /catalog_options/);
  }
  for (const cursor of [1, '', 'a\nb', 'x'.repeat(8193)]) assert.throws(() => api.buildChannel3Url({ cursor }), /catalog_cursor_invalid/);
  for (const filters of [[], 'bad', { unknown: true }, { availability: [] }, { availability: ['PreOrder'] }, { conditions: ['refurbished'] }, { conditions: ['new', 'new', 'used'] }]) {
    assert.throws(() => api.buildChannel3Url({ filters }), /catalog_options/);
  }
});

test('query identity uses NFC and collapsed whitespace while preserving case', () => {
  const api = adapter();
  for (const q of ['  cafe\u0301\u00a0  Shoes  ', 'café Shoes']) {
    assert.equal(new URL(api.buildChannel3Url({ q })).searchParams.get('q'), 'café Shoes');
    assert.equal(api.parseChannel3Page(envelope(), { q }).q, 'café Shoes');
  }
  assert.equal(new URL(api.buildChannel3Url({ q: 'Café Shoes' })).searchParams.get('q'), 'Café Shoes');
  assert.equal(new URL(api.buildChannel3Url({ q: 'a' + ' '.repeat(100) + 'b' })).searchParams.get('q'), 'a b');
  for (const q of ['a\nb', '\ud800', '\udc00']) assert.throws(() => api.buildChannel3Url({ q }), /catalog_options/);
});

test('category slugs containing digits retain the product with a core-compatible fallback kind', () => {
  const page = adapter().parseChannel3Page(envelope([product('care', { category: { slug: 'skin-care-2', title: 'Skin care' } })]));
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, 'care');
  assert.equal(page.items[0].kind, 'product');
  assert.equal(page.invalidCount, 0);
});

test('cursor pages keep server freshness, no invented total, one image and nullable continuation', () => {
  const api = adapter(), body = envelope([product('p1'), product('p2')], ' token+/= ');
  const page = api.parseChannel3Page(body, { q: 'shoes' });
  assert.equal(api.channel3Provider.pagination, 'cursor');
  assert.equal(api.provider.id, 'nike-live');
  assert.equal(api.nikeProvider, api.provider);
  assert.equal(page.nextCursor, ' token+/= ');
  assert.equal(page.total, null);
  assert.equal(page.nextOffset, undefined);
  assert.equal(page.fetchedAt, body.fetchedAt);
  assert.equal(page.expiresAt, body.expiresAt);
  assert.equal(page.items[0].updatedAt, body.fetchedAt);
  assert.equal(page.items[0].source.fetchedAt, body.fetchedAt);
  assert.equal(page.items[0].media.length, 1);
  assert.equal(api.parseChannel3Page(envelope([], null)).nextCursor, null);
});

test('three cursor pages expose overlap without discarding records or fabricating offsets', async () => {
  const bodies = [envelope([product('a'), product('b')], 'cursor-1'), envelope([product('b'), product('c')], 'cursor-2'), envelope([product('d')], null)];
  const seen = [];
  const api = adapter(async url => { seen.push(new URL(url).searchParams.get('page_token')); return new Response(JSON.stringify(bodies[seen.length - 1]), { headers: { 'content-type': 'application/json' } }); });
  const a = await api.fetchChannel3Page({ q: 'shoes' });
  const b = await api.fetchChannel3Page({ q: 'shoes', cursor: a.nextCursor });
  const c = await api.fetchChannel3Page({ q: 'shoes', cursor: b.nextCursor });
  assert.deepEqual(seen, [null, 'cursor-1', 'cursor-2']);
  assert.equal(b.items.map(x => x.id).join(','), 'b,c');
  assert.equal(c.nextCursor, null);
});

test('malformed, oversized, stale and future-dated cache envelopes are rejected', () => {
  const api = adapter();
  for (const body of [null, { products: [] }, envelope([], null, { provider: 'other' }), envelope([], null, { data: {} }),
    envelope([], 123), envelope(Array.from({ length: 25 }, (_, i) => product('p' + i))),
    envelope([], null, { fetchedAt: 'invalid' }), envelope([], null, { expiresAt: 'invalid' }),
    envelope([], null, { fetchedAt: new Date(Date.now() + 120000).toISOString() }),
    envelope([], null, { expiresAt: new Date(Date.now() - 1000).toISOString() })]) {
    assert.throws(() => api.parseChannel3Page(body), /catalog_payload|catalog_record_limit|catalog_cursor_invalid|catalog_expired/);
  }
});

test('invalid records are counted while an empty normalized page preserves continuation', () => {
  const page = adapter().parseChannel3Page(envelope([product('bad', { title: 'x'.repeat(201) })], 'next'));
  assert.equal(page.items.length, 0);
  assert.equal(page.invalidCount, 1);
  assert.equal(page.nextCursor, 'next');
});

test('cursor errors are safe, typed and never automatically restart the search', async () => {
  for (const [status, code] of [[400, 'catalog_cursor_invalid'], [410, 'catalog_cursor_expired']]) {
    let requests = 0;
    const api = adapter(async () => { requests++; return new Response('secret upstream diagnostics', { status }); });
    await assert.rejects(api.fetchChannel3Page({ q: 'shoes', cursor: 'token' }), error => error.code === code && error.message === code && error.status === status);
    assert.equal(requests, 1);
  }
});
