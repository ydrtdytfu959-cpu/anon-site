'use strict';
const { fail } = require('./errors.js');
const { object, hash, ID, text } = require('./validation.js');
const FRESHNESS_MS = 30000;
const LABELS = Object.freeze({ us_sales_tax: 'U.S. sales tax', us_shipping: 'Domestic U.S. shipping', international_shipping: 'International shipping to Algeria', customs_import: 'Customs duties and import taxes' });
function deliveryComponents() {
  return Object.entries(LABELS).map(([code, label]) => ({ code, label, amountMinor: null, currency: 'USD', status: 'unknown', source: null, ...(code === 'customs_import' ? { note: 'Import classification and responsibility for arrival charges are not established.' } : {}) }));
}
const reference = value => typeof value === 'string' && ID.test(value);
function inputError() { fail('delivery_input_invalid', 'Verified address references, measured parcels and a supported delivery destination are required.', 422); }
function positiveInteger(value, ceiling) { if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) inputError(); return value; }
// Server-internal contract, not an HTTP request schema. References must resolve
// to immutable, ownership-checked address/contents/service records in a future adapter.
// Shape validation does not prove a real address, measurement or carrier service.
function validateDeliveryRequest(value) {
  try {
    object(value, ['serviceRef', 'cartHash', 'currency', 'origin', 'destination', 'parcels']);
    if (!reference(value.serviceRef) || typeof value.cartHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.cartHash) || value.currency !== 'USD') inputError();
    object(value.origin, ['country', 'postalCode', 'addressRef']);
    if (value.origin.country !== 'US' || typeof value.origin.postalCode !== 'string' || !/^\d{5}(?:-\d{4})?$/.test(value.origin.postalCode) || !reference(value.origin.addressRef)) inputError();
    object(value.destination, ['country', 'postalCode', 'addressRef', 'deliveryMode', 'collectionPointRef']);
    const destination = value.destination;
    if (destination.country !== 'DZ' || typeof destination.postalCode !== 'string' || !/^\d{5}$/.test(destination.postalCode) || !reference(destination.addressRef)) inputError();
    if (destination.deliveryMode === 'postal_pickup' ? !reference(destination.collectionPointRef) : destination.deliveryMode !== 'home' || destination.collectionPointRef !== null) inputError();
    if (!Array.isArray(value.parcels) || value.parcels.length < 1 || value.parcels.length > 10) inputError();
    const parcels = value.parcels.map(parcel => {
      object(parcel, ['id', 'contentsRef', 'weightGrams', 'lengthMm', 'widthMm', 'heightMm']);
      if (!reference(parcel.id) || !reference(parcel.contentsRef)) inputError();
      // Defensive representation ceilings, not carrier capacity declarations.
      return { id: parcel.id, contentsRef: parcel.contentsRef, weightGrams: positiveInteger(parcel.weightGrams, 1000000000), lengthMm: positiveInteger(parcel.lengthMm, 1000000), widthMm: positiveInteger(parcel.widthMm, 1000000), heightMm: positiveInteger(parcel.heightMm, 1000000) };
    }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (new Set(parcels.map(parcel => parcel.id)).size !== parcels.length) inputError();
    return { serviceRef: value.serviceRef, cartHash: value.cartHash, currency: 'USD', origin: { ...value.origin }, destination: { ...destination }, parcels };
  } catch { inputError(); }
}
function evidenceError() { fail('delivery_evidence_invalid', 'Current delivery cost evidence could not be validated.', 503); }
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) evidenceError();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) evidenceError();
  return parsed;
}
function costs(components) {
  return { components, estimatedTotalMinor: null, verifiedPayableTotalMinor: null, potentialChargesOnArrival: components.filter(component => component.payer === 'customer_on_arrival' || (component.code === 'customs_import' && component.status === 'unknown')) };
}
// Only a reviewed server adapter can supply this context and authenticated
// provider response. This validator cannot establish provider authorization,
// invoice finality, insurance, stock reservation or permission to charge money.
function validateDeliveryEvidence(value, context) {
  try {
    if (!context || !Number.isSafeInteger(context.now) || context.now < 0 || context.now > 8640000000000000 || !reference(context.providerId)) evidenceError();
    const request = validateDeliveryRequest(context.request);
    object(value, ['provider', 'reference', 'requestHash', 'observedAt', 'expiresAt', 'components']);
    if (value.provider !== context.providerId || !reference(value.reference) || value.requestHash !== hash(request)) evidenceError();
    const observedAt = timestamp(value.observedAt), upstreamExpires = timestamp(value.expiresAt);
    if (observedAt > context.now || observedAt <= context.now - FRESHNESS_MS || upstreamExpires <= context.now || upstreamExpires <= observedAt) evidenceError();
    if (!Array.isArray(value.components) || value.components.length < 1 || value.components.length > Object.keys(LABELS).length) evidenceError();
    const validated = new Map();
    for (const component of value.components) {
      object(component, ['code', 'status', 'amountMinor', 'currency', 'payer', 'assumptions']);
      if (!Object.hasOwn(LABELS, component.code) || validated.has(component.code) || component.currency !== 'USD' || !['verified', 'estimated', 'unknown'].includes(component.status) || !['customer_before_purchase', 'customer_on_arrival', 'merchant', 'unknown'].includes(component.payer)) evidenceError();
      if (!Array.isArray(component.assumptions) || component.assumptions.length > 10 || component.assumptions.some(value => !text(value, 240) || /[<>]/.test(value))) evidenceError();
      if (component.status === 'unknown') {
        if (component.amountMinor !== null || component.payer !== 'unknown') evidenceError();
      } else {
        if (!Number.isSafeInteger(component.amountMinor) || component.amountMinor < 0 || component.amountMinor > 100000000 || component.payer === 'unknown') evidenceError();
        if (component.status === 'estimated' && component.assumptions.length === 0) evidenceError();
      }
      validated.set(component.code, { code: component.code, label: LABELS[component.code], amountMinor: component.amountMinor, currency: 'USD', status: component.status, source: value.provider, payer: component.payer, assumptions: [...component.assumptions] });
    }
    return { provider: value.provider, reference: value.reference, requestHash: value.requestHash, observedAt: value.observedAt, expiresAt: new Date(Math.min(upstreamExpires, observedAt + FRESHNESS_MS)).toISOString(), ...costs(deliveryComponents().map(component => validated.get(component.code) || component)) };
  } catch { evidenceError(); }
}
class DeliveryCostProvider {
  capabilities() { return { rates: false, insurance: false, labels: false, returns: false }; }
  async quote() { return { status: 'unavailable', reason: 'delivery_provider_unavailable', ...costs(deliveryComponents()) }; }
}
module.exports = { DeliveryCostProvider, deliveryComponents, validateDeliveryRequest, validateDeliveryEvidence };
