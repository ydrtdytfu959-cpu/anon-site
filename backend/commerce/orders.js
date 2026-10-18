'use strict';
const { fail } = require('./errors.js');
const { publicServiceRequest } = require('./service-requests.js');
const { safeUrl } = require('./quote.js');
const { ID, text } = require('./validation.js');
const ORDER_STATES = Object.freeze(['pending', 'confirmed', 'fulfilling', 'shipped', 'delivered', 'canceled', 'failed']);
const PAYMENT_STATES = Object.freeze(['pending', 'processing', 'succeeded', 'failed', 'canceled', 'partially_refunded', 'refunded']);
const FULFILLMENT_STATES = Object.freeze(['unfulfilled', 'processing', 'shipped', 'delivered', 'returned', 'unknown']);
function safeText(value, limit = 200) { return text(value, limit) ? value : null; }
function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function publicOrder(order) {
  if (order?.kind === 'service_request') return publicServiceRequest(order);
  if (!order || typeof order.orderId !== 'string' || !ID.test(order.orderId) || !validDate(order.createdAt) || (order.updatedAt !== undefined && !validDate(order.updatedAt)) || !ORDER_STATES.includes(order.status) || order.currency !== 'USD' || !Number.isSafeInteger(order.totalMinor) || order.totalMinor < 0 || !PAYMENT_STATES.includes(order.payment?.status)) fail('order_unavailable', 'This order record is unavailable.', 503);
  return { orderId: order.orderId, status: order.status, currency: order.currency, totalMinor: order.totalMinor, createdAt: order.createdAt, updatedAt: order.updatedAt || order.createdAt, merchantOrderReference: safeText(order.merchantOrderReference), payment: { status: order.payment.status }, fulfillment: { status: FULFILLMENT_STATES.includes(order.fulfillment?.status) ? order.fulfillment.status : 'unknown', tracking: Array.isArray(order.fulfillment?.tracking) ? order.fulfillment.tracking.slice(0, 20).filter(item => item && typeof item === 'object').map(item => ({ carrier: safeText(item.carrier, 80), trackingNumber: safeText(item.trackingNumber, 160), url: item.verified === true ? safeUrl(item.url) : null })) : [] }, capabilities: { cancel: false, refund: false } };
}
const transitions = { pending: ['confirmed', 'canceled', 'failed'], confirmed: ['fulfilling', 'canceled'], fulfilling: ['shipped'], shipped: ['delivered'], delivered: [], canceled: [], failed: [] };
function transitionOrder(order, nextStatus, expectedVersion, at) {
  if (!Number.isSafeInteger(expectedVersion) || order.version !== expectedVersion) fail('state_conflict', 'The order changed; read current state before retrying.', 409);
  if (!transitions[order.status]?.includes(nextStatus)) fail('invalid_transition', 'This order transition is not permitted.', 409);
  if (nextStatus === 'confirmed' && (!order.merchantOrderReference || order.payment?.status !== 'succeeded')) fail('confirmation_unverified', 'Merchant acceptance and verified payment are required for confirmation.', 409);
  return { ...order, status: nextStatus, version: order.version + 1, updatedAt: at };
}
module.exports = { publicOrder, transitionOrder, ORDER_STATES, PAYMENT_STATES, FULFILLMENT_STATES };
