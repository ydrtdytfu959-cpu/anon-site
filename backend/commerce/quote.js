'use strict';
const { fail } = require('./errors.js');
const { decimalToMinor, multiplyMinor, addMinor } = require('./money.js');
const { hash, productKey, text, canonical } = require('./validation.js');
const { checkout } = require('./providers.js');
const { deliveryComponents } = require('./delivery.js');
const SAFE_TITLE = 240;
const VOLATILE_TTL_MS = 30000;
function safeUrl(value) {
  try { const u = new URL(value); return typeof value === 'string' && value.length <= 2048 && u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; }
}
function offerUrl(value) {
  const url = safeUrl(value); if (!url) return null;
  const parsed = new URL(url); return parsed.hostname === 'buy.trychannel3.com' && !parsed.port ? url : null;
}
async function hydrate(lines, catalog, timeoutMs) {
  const unique = [...new Map(lines.map(line => [productKey(line), { productId: line.productId, options: line.options }])).entries()];
  const result = new Map(), controller = new AbortController(); let cursor = 0, timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('Fresh product deadline exceeded.'), { code: 'catalog_unavailable', statusCode: 503 })); }, timeoutMs); });
  const worker = async () => {
    while (!controller.signal.aborted) {
      const entry = unique[cursor++]; if (!entry) return;
      const value = await catalog.freshProduct(entry[1], { signal: controller.signal });
      if (controller.signal.aborted) return; result.set(entry[0], value);
    }
  };
  try { await Promise.race([Promise.all(Array.from({ length: Math.min(3, unique.length) }, worker)), deadline]); }
  catch { controller.abort(); fail('catalog_unavailable', 'Fresh product validation is temporarily unavailable. Please retry.', 503); }
  finally { clearTimeout(timer); }
  if (result.size !== unique.length) fail('catalog_unavailable', 'Fresh product validation did not complete.', 503);
  return result;
}
function validateLine(line, envelope, now) {
  const fetchedAt = Date.parse(envelope?.fetchedAt), expiresAt = Date.parse(envelope?.expiresAt);
  if (envelope?.provider !== 'channel3' || envelope?.status !== 'fresh' || envelope.error != null || !Number.isFinite(fetchedAt) || !Number.isFinite(expiresAt) || fetchedAt > now + 10000 || fetchedAt <= now - VOLATILE_TTL_MS || expiresAt <= now || expiresAt > fetchedAt + 300000) fail('catalog_unavailable', 'A fresh product snapshot could not be validated.', 503);
  const product = envelope?.data?.product;
  if (!product || product.id !== line.productId) fail('product_changed', 'The provider returned a different product.', 422);
  if (!Array.isArray(envelope.selectionMismatch) || envelope.selectionMismatch.length) fail('variant_changed', 'The provider could not retain the selected variant.', 422);
  const options = product.variants?.options || [], selected = product.variants?.selected || [];
  if (!Array.isArray(options) || !Array.isArray(selected) || options.length > 8 || selected.length > 8 || new Set(options.map(x => x.name)).size !== options.length || new Set(selected.map(x => x.name)).size !== selected.length) fail('variant_invalid', 'Product variant information is incomplete.', 422);
  if (options.length !== Object.keys(line.options).length) fail('variant_required', 'Select every required product variant.', 422);
  let variantUnavailable = false, variantUnknown = false;
  for (const [name, label] of Object.entries(line.options)) {
    const definition = options.find(option => option.name === name), effective = selected.find(option => option.name === name);
    const values = Array.isArray(definition?.values) ? definition.values.filter(value => value.label === label) : [];
    if (values.length !== 1 || values[0].exists !== true || effective?.label !== label || (values[0].product_id != null && values[0].product_id !== line.productId)) fail('variant_changed', 'The selected variant cannot be confirmed for this product.', 422);
    if (values[0].available === 'OutOfStock') variantUnavailable = true;
    else if (values[0].available !== 'InStock') variantUnknown = true;
  }
  if (selected.some(value => !Object.hasOwn(line.options, value.name))) fail('variant_changed', 'The provider selected an unrequested variant.', 422);
  const matching = Array.isArray(product.offers) ? product.offers.filter(offer => offer.domain === line.merchantDomain && (offer.condition ?? null) === line.condition) : [];
  if (!matching.length || matching.length > 20) fail('offer_unavailable', 'The selected merchant offer is unavailable.', 422);
  const normalized = matching.map(offer => {
    if (offer.price?.currency !== 'USD') fail('offer_price_unavailable', 'The selected offer has no supported USD price.', 422);
    return { unitPriceMinor: decimalToMinor(offer.price.price), availability: variantUnavailable || offer.availability === 'OutOfStock' ? 'OutOfStock' : variantUnknown ? 'unknown' : offer.availability === 'InStock' ? 'InStock' : 'unknown', url: offerUrl(offer.url), maxCommissionRate: typeof offer.max_commission_rate === 'number' && Number.isFinite(offer.max_commission_rate) && offer.max_commission_rate >= 0 && offer.max_commission_rate <= 1 ? offer.max_commission_rate : null };
  });
  if (new Set(normalized.map(canonical)).size !== 1) fail('offer_ambiguous', 'This merchant has multiple indistinguishable offers. A unique offer is required.', 422);
  const offer = normalized[0];
  return { expiresAt: Math.min(expiresAt, fetchedAt + VOLATILE_TTL_MS), value: { ...line, title: text(product.title, 2000) ? Array.from(product.title).slice(0, SAFE_TITLE).join('') : 'Product', unitPriceMinor: offer.unitPriceMinor, lineTotalMinor: multiplyMinor(offer.unitPriceMinor, line.quantity), currency: 'USD', availability: offer.availability, validatedAt: new Date(fetchedAt).toISOString(), offer: { domain: line.merchantDomain, url: offer.url, maxCommissionRate: offer.maxCommissionRate }, selection: { valid: true } } };
}
function component(code, label, amountMinor, status, source, note) { return { code, label, amountMinor, currency: 'USD', status, source, ...(note ? { note } : {}) }; }
async function buildQuote({ input, catalog, now, randomId, hydrationTimeoutMs = 9000 }) {
  const products = await hydrate(input.lines, catalog, hydrationTimeoutMs);
  // Read time after hydration so a slow request cannot extend a provider snapshot.
  const current = now(), validated = input.lines.map(line => validateLine(line, products.get(productKey(line)), current));
  const lines = validated.map(x => x.value), subtotal = addMinor(lines.map(line => line.lineTotalMinor));
  const delivery = deliveryComponents(), customs = delivery.find(value => value.code === 'customs_import');
  const components = [component('products', 'Products', subtotal, 'estimated', 'channel3', 'Fresh catalog prices are not a merchant purchase reservation or quantity guarantee.'), ...delivery, component('currency_conversion', 'Currency conversion', 0, 'verified', 'quote_currency', 'This quote is denominated in USD; no currency conversion is performed.'), component('anox_service_fee', 'AnoX service fee', 500, 'conditional', 'anox', 'Exactly $5 per successfully completed order. Nothing is collected for a blocked attempt.')];
  const capability = checkout();
  capability.blockers.push({ code: 'landed_cost_unverified', message: 'Verified U.S. tax, shipping, and Algeria import charges are unavailable.' }, { code: 'quantity_unreserved', message: 'Catalog availability does not reserve the requested quantity.' });
  for (const line of lines) if (line.availability !== 'InStock') capability.blockers.push({ code: line.availability === 'OutOfStock' ? 'availability_unavailable' : 'availability_unknown', message: line.availability === 'OutOfStock' ? 'A selected product is unavailable.' : 'Availability for a selected product is unknown.' });
  return { quoteId: randomId(), cartHash: hash({ lines: input.lines, destination: input.destination, currency: input.currency }), cartRevision: input.cartRevision, createdAt: new Date(current).toISOString(), expiresAt: new Date(Math.min(current + VOLATILE_TTL_MS, ...validated.map(x => x.expiresAt))).toISOString(), currency: 'USD', destination: input.destination, lines, costs: { components, estimatedTotalMinor: null, verifiedPayableTotalMinor: null, potentialChargesOnArrival: [customs] }, checkout: capability };
}
module.exports = { buildQuote, safeUrl, validateLine };
