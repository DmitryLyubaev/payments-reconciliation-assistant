import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateTax, parseMinor, roundHalfUp } from '../../src/domain/money.js';

test('item rounding explains one cent without binary floating point', () => {
  assert.deepEqual(calculateTax(['1005', '1005'], 'per_item'), {
    subtotalMinor: '2010',
    taxMinor: '202',
    grossMinor: '2212',
  });
  assert.deepEqual(calculateTax(['1005', '1005'], 'per_receipt'), {
    subtotalMinor: '2010',
    taxMinor: '201',
    grossMinor: '2211',
  });
  assert.equal(roundHalfUp(5n, 2n), 3n);
  assert.equal(roundHalfUp(4n, 2n), 2n);
});
test('money rejects noncanonical and out-of-range input', () => {
  for (const value of ['1.01', '-1', '01', '1e3', '1000000000000000000'])
    assert.throws(() => parseMinor(value));
  assert.equal(parseMinor('999999999999999999'), 999999999999999999n);
  assert.throws(() => roundHalfUp(1n, 0n));
  assert.throws(() => roundHalfUp(1n, -1n));
  assert.throws(() => calculateTax(['999999999999999999'], 'per_item'), /OVERFLOW/);
});
