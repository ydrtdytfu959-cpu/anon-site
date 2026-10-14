const test = require('node:test');
const assert = require('node:assert/strict');
const { decimalToMinor, addMinor, multiplyMinor } = require('../backend/commerce/money.js');
test('money uses exact decimal strings and integer minor units', () => {
  assert.equal(decimalToMinor('19.99'), 1999); assert.equal(decimalToMinor(0.1), 10);
  assert.equal(decimalToMinor('0.29'), 29); assert.equal(decimalToMinor('999999.99'), 99999999);
  assert.equal(addMinor([10, 20, 500]), 530); assert.equal(multiplyMinor(1999, 3), 5997);
});
test('money rejects unsupported decimals, negative/nonfinite values and rounding', () => {
  for (const value of ['1.999', '1e3', '-1', 'NaN', 'Infinity', '', null, Infinity, 0.30000000000000004, '1000001']) assert.throws(() => decimalToMinor(value));
  assert.throws(() => addMinor([Number.MAX_SAFE_INTEGER, 1])); assert.throws(() => multiplyMinor(Number.MAX_SAFE_INTEGER, 2)); assert.throws(() => multiplyMinor(10, 1.5));
});
