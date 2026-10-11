'use strict';
const { fail } = require('./errors.js');
function checked(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('invalid_money', 'Money must be a nonnegative safe integer in minor units.', 422);
  return value;
}
function decimalToMinor(value) {
  if (typeof value !== 'string' && typeof value !== 'number') fail('invalid_money', 'A decimal price is required.', 422);
  const source = String(value);
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(source)) fail('invalid_money', 'Price must be an exact decimal with at most two fractional digits.', 422);
  const [whole, fraction = ''] = source.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor > 100000000n) fail('invalid_money', 'Price exceeds the supported limit.', 422);
  return checked(Number(minor));
}
function addMinor(values) {
  let total = 0n; for (const value of values) total += BigInt(checked(value));
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) fail('invalid_money', 'Amount exceeds the supported limit.', 422);
  return Number(total);
}
function multiplyMinor(amount, quantity) { checked(quantity); return addMinor([checked(Number(BigInt(checked(amount)) * BigInt(quantity)))]); }
module.exports = { decimalToMinor, addMinor, multiplyMinor, checked };
