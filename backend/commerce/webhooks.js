'use strict';
const crypto = require('node:crypto');
const { fail } = require('./errors.js');
// Pure foundation only: no active HTTP route, secret retrieval or payment APIs.
function verifyStripeSignature({ rawBody, signature, secret, now = Date.now(), toleranceSeconds = 300 }) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length > 256000 || typeof signature !== 'string' || signature.length > 4096 || typeof secret !== 'string' || secret.length < 16) fail('invalid_signature', 'Webhook signature verification failed.', 400);
  const fields = signature.split(',').map(value => value.trim().split('='));
  const timestamps = fields.filter(([key]) => key === 't'), signatures = fields.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (timestamps.length !== 1 || !/^\d{10,12}$/.test(timestamps[0][1] || '') || !Number.isSafeInteger(toleranceSeconds) || toleranceSeconds < 1 || toleranceSeconds > 300) fail('invalid_signature', 'Webhook signature verification failed.', 400);
  const timestamp = Number(timestamps[0][1]);
  if (Math.abs(now / 1000 - timestamp) > toleranceSeconds) fail('invalid_signature', 'Webhook signature has expired.', 400);
  const expected = crypto.createHmac('sha256', secret).update(timestamps[0][1] + '.').update(rawBody).digest();
  if (!signatures.some(value => /^[0-9a-f]{64}$/i.test(value || '') && crypto.timingSafeEqual(expected, Buffer.from(value, 'hex')))) fail('invalid_signature', 'Webhook signature verification failed.', 400);
  try { return JSON.parse(rawBody.toString('utf8')); } catch { fail('invalid_webhook', 'Webhook body must be JSON.', 400); }
}
async function processStripeEvent({ event, store, now = Date.now() }) {
  if (!event || typeof event.id !== 'string' || !/^evt_[A-Za-z0-9]{1,160}$/.test(event.id) || event.object !== 'event' || typeof event.livemode !== 'boolean' || !Number.isSafeInteger(event.created)) fail('invalid_webhook', 'Invalid payment event.', 400);
  const supported = ['payment_intent.succeeded', 'payment_intent.processing', 'payment_intent.payment_failed', 'payment_intent.canceled', 'charge.refunded'];
  if (!supported.includes(event.type)) return { ignored: true };
  const payment = event.data?.object, refund = event.type === 'charge.refunded', paymentId = refund ? payment?.payment_intent : payment?.id;
  if (!payment || typeof paymentId !== 'string' || !/^pi_[A-Za-z0-9]{1,160}$/.test(paymentId) || payment.object !== (refund ? 'charge' : 'payment_intent')) fail('invalid_webhook', 'Invalid payment object.', 400);
  const binding = await store.getPaymentBinding(paymentId);
  if (!binding) fail('payment_binding_missing', 'No expected payment is bound to this event.', 409);
  const expected = binding.expectedAmountMinor;
  if (binding.paymentId !== paymentId || !Number.isSafeInteger(expected) || expected < 0 || payment.amount !== expected || payment.currency !== binding.currency || (event.account ?? null) !== binding.account || event.livemode !== binding.livemode || payment.livemode !== binding.livemode || payment.metadata?.anox_attempt_id !== binding.attemptId || payment.metadata?.anox_order_id !== binding.orderId || (event.type === 'payment_intent.succeeded' && payment.amount_received !== expected)) fail('payment_binding_mismatch', 'Payment event does not match the expected order, amount or account.', 409);
  // Validate even repeat deliveries so mismatched payloads never receive success.
  if (await store.hasWebhook(event.id)) return { duplicate: true };
  const order = await store.get(binding.owner, 'order', binding.orderId);
  if (!order || !Number.isSafeInteger(order.version) || order.version < 1) fail('state_conflict', 'The expected order payment state changed.', 409);
  if (order.payment?.amountMinor !== expected || ['paymentId', 'attemptId', 'currency', 'account', 'livemode'].some(field => order.payment?.[field] !== binding[field])) fail('payment_binding_mismatch', 'This payment is not the active payment for the order.', 409);
  const current = order.payment, next = { ...current };
  if (refund) {
    if (!Number.isSafeInteger(payment.amount_refunded) || payment.amount_refunded < 0 || payment.amount_refunded > expected || !['succeeded', 'partially_refunded', 'refunded'].includes(current.status)) fail('refund_unverified', 'Refund principal or payment state is invalid.', 409);
    next.refundedMinor = Math.max(current.refundedMinor || 0, payment.amount_refunded);
    next.status = next.refundedMinor === expected ? 'refunded' : next.refundedMinor > 0 ? 'partially_refunded' : 'succeeded';
  } else if (!['succeeded', 'partially_refunded', 'refunded', 'canceled'].includes(current.status)) {
    const status = { 'payment_intent.succeeded': 'succeeded', 'payment_intent.processing': 'processing', 'payment_intent.payment_failed': 'failed', 'payment_intent.canceled': 'canceled' }[event.type];
    // Failure may later be retried on the same PaymentIntent; event time prevents
    // older processing/failure deliveries from reversing the more recent state.
    if (status === 'succeeded' || event.created >= (current.lastEventCreated || 0)) { next.status = status; next.lastEventCreated = event.created; }
  }
  return store.applyWebhook({ eventId: event.id, binding, expectedOrderVersion: order.version, payment: next, audit: { eventId: event.id, type: 'stripe.' + event.type, resourceId: binding.orderId, at: new Date(now).toISOString(), previousPaymentStatus: current.status, paymentStatus: next.status } });
}
module.exports = { verifyStripeSignature, processStripeEvent };
