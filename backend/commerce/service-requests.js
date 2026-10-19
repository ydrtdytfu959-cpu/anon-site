'use strict';
const { fail } = require('./errors.js');
const { ID, text, hash } = require('./validation.js');
const { serviceFee } = require('./providers.js');
const HISTORICAL_PRICE_NOTE = 'Historical product price estimate recorded with this request. It is not a current price, stock confirmation or purchase reservation.';
function historicalLine(line) {
  return { provider: line.provider, productId: line.productId, merchantDomain: line.merchantDomain, condition: line.condition, options: { ...line.options }, quantity: line.quantity, title: line.title, unitPriceMinor: line.unitPriceMinor, lineTotalMinor: line.lineTotalMinor, currency: line.currency, priceStatus: 'historical_estimate', capturedAt: line.validatedAt, availability: 'unknown', validatedAt: line.validatedAt, offer: { domain: line.merchantDomain, url: null, maxCommissionRate: null }, selection: { valid: true } };
}
function historicalCosts(costs) {
  const component = c => ({ code: c.code, label: c.label, amountMinor: c.amountMinor, currency: c.currency, status: c.status, source: c.source, ...(c.code === 'products' ? { note: HISTORICAL_PRICE_NOTE } : text(c.note, 1000) ? { note: c.note } : {}) });
  return { components: costs.components.map(component), estimatedTotalMinor: null, verifiedPayableTotalMinor: null, potentialChargesOnArrival: costs.potentialChargesOnArrival.map(component) };
}
// A request is an authenticated expression of customer interest. It does not
// order merchandise, collect a fee, reserve stock or book a carrier service.
function buildServiceRequest({ quote, now }) {
  return {
    orderId: 'service_' + hash(quote.quoteId), kind: 'service_request', version: 1, status: 'received',
    createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
    quoteId: quote.quoteId, cartRevision: quote.cartRevision, cartHash: quote.cartHash,
    currency: 'USD', totalMinor: null, destination: { country: 'DZ' },
    lines: quote.lines.map(historicalLine), costs: historicalCosts(quote.costs),
    serviceFee: serviceFee(), payment: { status: 'not_requested' },
    merchantOrderReference: null, fulfillment: { status: 'not_requested', tracking: [] },
    capabilities: { cancel: false, refund: false }
  };
}
function publicServiceRequest(value) {
  const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
  if (!value || !ID.test(value.orderId || '') || !date(value.createdAt) || !date(value.updatedAt) || value.kind !== 'service_request' || value.status !== 'received' || value.currency !== 'USD' || value.totalMinor !== null || value.destination?.country !== 'DZ' || value.payment?.status !== 'not_requested' || value.serviceFee?.amountMinor !== 500 || value.serviceFee?.appliesOn !== 'owner_decision_pending' || value.serviceFee?.collectionEnabled !== false || !Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 10 || value.costs?.verifiedPayableTotalMinor !== null || value.costs?.estimatedTotalMinor !== null) fail('order_unavailable', 'This service request is unavailable.', 503);
  return {
    orderId: value.orderId, kind: 'service_request', status: 'received', createdAt: value.createdAt, updatedAt: value.updatedAt,
    quoteId: value.quoteId, cartRevision: value.cartRevision, cartHash: value.cartHash, currency: 'USD', totalMinor: null,
    destination: { country: 'DZ' },
    lines: value.lines.map(historicalLine), costs: historicalCosts(value.costs),
    serviceFee: serviceFee(), payment: { status: 'not_requested' }, merchantOrderReference: null,
    fulfillment: { status: 'not_requested', tracking: [] }, capabilities: { cancel: false, refund: false }
  };
}
module.exports = { buildServiceRequest, publicServiceRequest };
