import type { Minor, Policy } from './contracts.js';

const MAX = 999999999999999999n;
export function parseMinor(raw: string): bigint {
  if (!/^(0|[1-9][0-9]{0,17})$/.test(raw)) throw new Error('INVALID_MONEY');
  return BigInt(raw);
}
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new Error('INVALID_RATIONAL');
  return (2n * numerator + denominator) / (2n * denominator);
}
export function serializeMinor(value: bigint): Minor {
  if (value < 0n || value > MAX) throw new Error('MONEY_OVERFLOW');
  return value.toString();
}
export function calculateTax(
  lines: Minor[],
  rounding: Policy['rounding'],
): { subtotalMinor: Minor; taxMinor: Minor; grossMinor: Minor } {
  if (!lines.length || !['per_item', 'per_receipt'].includes(rounding))
    throw new Error('INVALID_CALCULATION');
  const values = lines.map(parseMinor);
  if (values.some((value) => value <= 0n)) throw new Error('INVALID_ITEM');
  const subtotal = values.reduce((sum, value) => sum + value, 0n);
  const tax =
    rounding === 'per_item'
      ? values.reduce((sum, value) => sum + roundHalfUp(value * 1000n, 10000n), 0n)
      : roundHalfUp(subtotal * 1000n, 10000n);
  return {
    subtotalMinor: serializeMinor(subtotal),
    taxMinor: serializeMinor(tax),
    grossMinor: serializeMinor(subtotal + tax),
  };
}
