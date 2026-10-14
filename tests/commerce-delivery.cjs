'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../backend/commerce/delivery.js');
test('delivery contract is a canonical server module', () => assert.equal(fs.existsSync(file), true));
if (fs.existsSync(file)) {
  const { DeliveryCostProvider, deliveryComponents, validateDeliveryRequest, validateDeliveryEvidence } = require(file);
  const { hash } = require('../backend/commerce/validation.js');
  const now = Date.parse('2026-10-13T12:00:00.000Z');
  const request = () => ({ serviceRef: 'service_us_dz_v1', cartHash: 'a'.repeat(64), currency: 'USD', origin: { country: 'US', postalCode: '10001', addressRef: 'origin_v1' }, destination: { country: 'DZ', postalCode: '16027', addressRef: 'destination_v1', deliveryMode: 'home', collectionPointRef: null }, parcels: [{ id: 'parcel_1', contentsRef: 'contents_v1', weightGrams: 1000, lengthMm: 300, widthMm: 200, heightMm: 100 }] });
  const evidence = () => ({ provider: 'fixture_carrier', reference: 'quote_1', requestHash: hash(validateDeliveryRequest(request())), observedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 29000).toISOString(), components: [{ code: 'international_shipping', status: 'verified', amountMinor: 1234, currency: 'USD', payer: 'customer_before_purchase', assumptions: [] }] });
  const context = () => ({ request: request(), providerId: 'fixture_carrier', now });
  const invalidRequest = fn => assert.throws(fn, error => error.code === 'delivery_input_invalid' && error.statusCode === 422);
  const invalidEvidence = fn => assert.throws(fn, error => error.code === 'delivery_evidence_invalid' && error.statusCode === 503 && !error.message.includes('secret'));
  test('disabled provider returns all delivery costs unknown and never a payable total', async () => {
    const provider = new DeliveryCostProvider();
    assert.deepEqual(provider.capabilities(), { rates: false, insurance: false, labels: false, returns: false });
    const result = await provider.quote(request());
    assert.equal(result.status, 'unavailable'); assert.equal(result.reason, 'delivery_provider_unavailable');
    assert.equal(result.verifiedPayableTotalMinor, null); assert.equal(result.estimatedTotalMinor, null);
    assert.equal(result.components.length, 4);
    assert.ok(result.components.every(x => x.amountMinor === null && x.status === 'unknown' && x.source === null));
  });
  test('delivery component instances do not leak changes into subsequent quotes', () => {
    const components = deliveryComponents(); components[0].amountMinor = 0;
    assert.equal(deliveryComponents()[0].amountMinor, null);
  });
  test('canonical measured parcel request preserves integers and stable identity across parcel order', () => {
    const first = request(); first.parcels.push({ ...first.parcels[0], id: 'parcel_2' });
    const second = structuredClone(first); second.parcels.reverse();
    const normalized = validateDeliveryRequest(first);
    assert.equal(normalized.serviceRef, 'service_us_dz_v1');
    assert.equal(normalized.parcels[0].weightGrams, 1000);
    assert.equal(hash(normalized), hash(validateDeliveryRequest(second)));
    normalized.parcels[0].weightGrams = 5; assert.equal(first.parcels[0].weightGrams, 1000);
  });
  test('unknown parcels, arbitrary units, zero or fractional dimensions and duplicate parcel IDs are rejected', () => {
    for (const mutation of [r => { delete r.parcels; }, r => { r.parcels = []; }, r => { r.parcels[0].weightOz = 2; }, r => { r.parcels[0].weightGrams = 0; }, r => { r.parcels[0].heightMm = 0.5; }, r => { r.parcels[0].widthMm = '200'; }, r => { r.parcels[0].lengthMm = Number.MAX_SAFE_INTEGER; }, r => r.parcels.push({ ...r.parcels[0] })]) { const value = request(); mutation(value); invalidRequest(() => validateDeliveryRequest(value)); }
  });
  test('destination format is not proof of service; unsupported currencies and delivery modes fail', () => {
    for (const mutation of [r => { r.destination.country = 'FR'; }, r => { r.destination.postalCode = '1602'; }, r => { r.currency = 'DZD'; }, r => { r.destination.deliveryMode = 'automatic'; }, r => { r.origin.postalCode = 'unknown'; }, r => { r.origin.addressRef = 'https://secret.invalid'; }, r => { r.totalMinor = 0; }]) { const value = request(); mutation(value); invalidRequest(() => validateDeliveryRequest(value)); }
  });
  test('postal pickup requires an explicit collection-point reference and cannot silently become home delivery', () => {
    const value = request(); value.destination.deliveryMode = 'postal_pickup';
    invalidRequest(() => validateDeliveryRequest(value)); value.destination.collectionPointRef = 'postal_office_16027';
    assert.equal(validateDeliveryRequest(value).destination.deliveryMode, 'postal_pickup');
    value.destination.deliveryMode = 'home'; invalidRequest(() => validateDeliveryRequest(value));
  });
  test('provider evidence retains exact minor units without declaring missing taxes or total zero', () => {
    const result = validateDeliveryEvidence(evidence(), context());
    assert.equal(result.components.find(x => x.code === 'international_shipping').amountMinor, 1234);
    assert.equal(result.components.find(x => x.code === 'international_shipping').status, 'verified');
    assert.ok(result.components.filter(x => x.code !== 'international_shipping').every(x => x.status === 'unknown' && x.amountMinor === null));
    assert.equal(result.estimatedTotalMinor, null); assert.equal(result.verifiedPayableTotalMinor, null);
    assert.equal(result.potentialChargesOnArrival[0].code, 'customs_import');
    assert.equal(Object.hasOwn(result, 'checkout'), false);
  });
  test('evidence cannot cross provider, cart, address, contents, pickup mode or parcel boundaries', () => {
    const raw = evidence(); raw.provider = 'unexpected'; invalidEvidence(() => validateDeliveryEvidence(raw, context()));
    for (const mutation of [r => { r.serviceRef = 'other_carrier_shipdate_insurance'; }, r => { r.cartHash = 'b'.repeat(64); }, r => { r.destination.addressRef = 'other_user_v1'; }, r => { r.destination.deliveryMode = 'postal_pickup'; r.destination.collectionPointRef = 'office_1'; }, r => { r.parcels[0].weightGrams++; }, r => { r.parcels[0].contentsRef = 'other_contents'; }]) { const ctx = context(); mutation(ctx.request); invalidEvidence(() => validateDeliveryEvidence(evidence(), ctx)); }
  });
  test('stale, future, missing expiry and malformed dates never become current evidence', () => {
    for (const mutation of [e => { e.expiresAt = new Date(now).toISOString(); }, e => { e.observedAt = new Date(now - 30000).toISOString(); }, e => { e.observedAt = new Date(now + 1).toISOString(); }, e => { delete e.expiresAt; }, e => { e.observedAt = 'October 13, 2026'; }, e => { e.expiresAt = '2026-02-30T12:00:00.000Z'; }]) { const raw = evidence(); mutation(raw); invalidEvidence(() => validateDeliveryEvidence(raw, context())); }
    const raw = evidence(); raw.expiresAt = new Date(now + 3600000).toISOString();
    assert.equal(validateDeliveryEvidence(raw, context()).expiresAt, new Date(now + 29000).toISOString());
  });
  test('unsupported currency, floating precision, negative, overflow, strings and unknown amount coercion fail', () => {
    for (const mutation of [c => { c.currency = 'DZD'; }, c => { c.amountMinor = 12.34; }, c => { c.amountMinor = -1; }, c => { c.amountMinor = Number.MAX_SAFE_INTEGER + 1; }, c => { c.amountMinor = '1234'; }, c => { c.amountMinor = NaN; }, c => { c.status = 'unknown'; }, c => { c.status = 'verified'; c.amountMinor = null; }]) { const raw = evidence(); mutation(raw.components[0]); invalidEvidence(() => validateDeliveryEvidence(raw, context())); }
  });
  test('estimated charges require documented assumptions and never become guaranteed', () => {
    const raw = evidence(); raw.components[0].status = 'estimated';
    invalidEvidence(() => validateDeliveryEvidence(raw, context()));
    raw.components[0].assumptions = ['Carrier adjustment remains possible.'];
    const result = validateDeliveryEvidence(raw, context());
    assert.equal(result.components.find(x => x.code === 'international_shipping').status, 'estimated'); assert.equal(result.verifiedPayableTotalMinor, null);
  });
  test('unsafe diagnostics, unrecognized, duplicated or missing components fail without leaking input', () => {
    for (const mutation of [e => { e.secret = 'secret'; }, e => { e.reference = '<script>secret</script>'; }, e => { e.components[0].code = 'anox_service_fee'; }, e => e.components.push({ ...e.components[0] }), e => { e.components = []; }, e => { e.components[0].payer = 'anyone'; }, e => { e.components[0].assumptions = ['<img src=x onerror=secret>']; }]) { const raw = evidence(); mutation(raw); invalidEvidence(() => validateDeliveryEvidence(raw, context())); }
  });
  test('verified arrival charges remain separate and all verified components still cannot activate checkout', () => {
    const raw = evidence(); raw.components = deliveryComponents().map(c => ({ code: c.code, amountMinor: c.code === 'customs_import' ? 1 : 0, currency: 'USD', status: 'verified', payer: c.code === 'customs_import' ? 'customer_on_arrival' : 'merchant', assumptions: [] }));
    const result = validateDeliveryEvidence(raw, context());
    assert.equal(result.potentialChargesOnArrival[0].amountMinor, 1); assert.equal(result.verifiedPayableTotalMinor, null);
    assert.equal(result.components.filter(x => x.code === 'anox_service_fee').length, 0);
  });
  test('invalid server validation context fails closed', () => {
    for (const ctx of [null, { ...context(), now: NaN }, { ...context(), now: '1234' }, { ...context(), providerId: '' }]) invalidEvidence(() => validateDeliveryEvidence(evidence(), ctx));
  });
}
