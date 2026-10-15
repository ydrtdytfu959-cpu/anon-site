'use strict';

// Read-only CJ source adapter. No network, credentials, public routes or spending
// are created by importing this module. Activation must be separately approved.
const OFFICIAL_SOURCES = Object.freeze({
  tjmaxx: Object.freeze({
    store: 'TJ Maxx',
    advertiserId: '4438309',
    advertiserName: 'TJ Maxx',
    domains: Object.freeze(['tjmaxx.tjx.com', 'www.tjmaxx.tjx.com', 'tjmaxx.com', 'www.tjmaxx.com'])
  })
});

function safeUrl(value) {
  try {
    if (typeof value !== 'string' || value.length > 2048) return null;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    if (!url.hostname || url.hostname.endsWith('.')) return null;
    return url;
  } catch {
    return null;
  }
}
function text(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function allowedImage(value, approvedImageHosts) {
  const parsed = safeUrl(value);
  if (!parsed || !approvedImageHosts.has(parsed.hostname.toLowerCase())) return null;
  return parsed.href;
}
function normalizeTJMaxxProduct(input, {approvedImageHosts = []} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const source = OFFICIAL_SOURCES.tjmaxx;
  if (String(input.advertiserId || '') !== source.advertiserId ||
      text(input.advertiserName, 100).toLowerCase() !== source.advertiserName.toLowerCase()) return null;
  const id = text(input.id, 80), title = text(input.title, 200);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !title) return null;
  const merchantUrl = safeUrl(input.link);
  if (!merchantUrl || !source.domains.includes(merchantUrl.hostname.toLowerCase())) return null;
  const hosts = new Set(approvedImageHosts);
  const imageUrl = allowedImage(input.imageLink, hosts);
  // No CJ feed price, stock, offer, commission or short-lived affiliate URL
  // becomes an authoritative purchasable quote in AnoX.
  return Object.freeze({
    id: 'cj-tjmaxx-' + id, productId: id,
    store: source.store, title, description: text(input.description, 1200),
    merchantUrl: merchantUrl.href, imageUrl,
    source: 'CJ', presentationOnly: true, priceCents: null,
    stock: null, availability: 'unknown', purchasable: false
  });
}
function err(statusCode, error) {
  return {statusCode, body: {error}};
}
function createOfficialCJSource({search, authorization = null, approvedImageHosts = []} = {}) {
  if (typeof search !== 'function') throw Error('CJ search dependency required');
  if (!Array.isArray(approvedImageHosts) || approvedImageHosts.length > 16 ||
      approvedImageHosts.some(h => typeof h !== 'string' || !/^[a-z0-9.-]{3,120}$/.test(h))) {
    throw Error('Invalid reviewed image host allowlist');
  }
  const imageHosts = Object.freeze([...new Set(approvedImageHosts)]);
  return Object.freeze({
    async page({store = 'tjmaxx', offset = 0, limit = 24} = {}) {
      const source = OFFICIAL_SOURCES[store];
      if (!source) return err(404, 'STORE_NOT_FOUND');
      // Fail closed. Search access is NOT commercial-feed authorization.
      // A real approved relationship and product-display rights must be verified
      // outside this module before passing this exact evidence-backed approval.
      if (!authorization || authorization.store !== store ||
          authorization.approved !== true ||
          typeof authorization.evidence !== 'string' ||
          authorization.evidence.trim().length < 12) {
        return err(403, 'OFFICIAL_FEED_NOT_AUTHORIZED');
      }
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 5000 ||
          !Number.isSafeInteger(limit) || limit < 1 || limit > 24) {
        return err(400, 'INVALID_PAGE');
      }
      let response;
      try {
        response = await search({partnerIds: [source.advertiserId], offset, limit});
      } catch {
        return err(503, 'CJ_SOURCE_UNAVAILABLE');
      }
      if (!response || !Array.isArray(response.resultList) ||
          response.resultList.length > limit || !Number.isSafeInteger(response.totalCount) ||
          response.totalCount < 0 || response.totalCount > 10000000) {
        return err(502, 'CJ_SOURCE_INVALID');
      }
      const seen = new Set(), products = [];
      for (const raw of response.resultList) {
        const product = normalizeTJMaxxProduct(raw, {approvedImageHosts: imageHosts});
        if (!product || seen.has(product.id)) continue;
        seen.add(product.id);
        products.push(product);
      }
      const end = offset + response.resultList.length;
      return {statusCode: 200, body: {
        source: 'CJ', store: source.store, offset, limit, totalCount: response.totalCount,
        rawCount: response.resultList.length, acceptedCount: products.length,
        rejectedCount: response.resultList.length - products.length,
        nextOffset: response.resultList.length && end < response.totalCount && end <= 5000 ? end : null,
        products
      }};
    }
  });
}
module.exports = {OFFICIAL_SOURCES, normalizeTJMaxxProduct, createOfficialCJSource};
