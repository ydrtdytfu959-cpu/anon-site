'use strict';
const { fail } = require('./errors.js');
// Implementations must establish merchant participation and operational guarantees.
// Configuration alone cannot supply those guarantees or enable payment collection.
class CheckoutProvider {
  capabilities() { return { checkout: false, cancellation: false, refund: false, fulfillment: false }; }
  async createOrder() { fail('operation_unsupported', 'Merchant purchasing is not supported by this provider.', 409); }
  async cancelOrder() { fail('operation_unsupported', 'Merchant cancellation is not supported by this provider.', 409); }
  async refundOrder() { fail('operation_unsupported', 'Merchant refunds are not supported by this provider.', 409); }
}
class Channel3CheckoutProvider extends CheckoutProvider {
  get id() { return 'channel3'; }
  blockers() { return [{ code: 'merchant_checkout_unavailable', message: 'Channel3 catalog access does not establish an authorized merchant purchasing integration.' }, { code: 'payment_arrangement_unverified', message: 'A supported merchant payment arrangement and fee collection approved by the owner have not been established.' }]; }
}
const channel3 = Object.freeze(new Channel3CheckoutProvider());
const checkout = () => ({ enabled: false, blockers: channel3.blockers() });
const serviceFee = () => ({ currency: 'USD', amountMinor: 500, appliesOn: 'owner_decision_pending', collectionEnabled: false });
module.exports = { CheckoutProvider, Channel3CheckoutProvider, checkout, serviceFee };
