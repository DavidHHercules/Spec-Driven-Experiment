import { describe, expect, it } from 'vitest';
import { parseCoordinate } from '../src/core/validate';

// Copied row-for-row from spec §4.1. If the spec table changes, this table changes.
describe('parseCoordinate (spec §4.1, D2)', () => {
  it.each([
    ['47.6', 47.6],
    ['-122.3', -122.3],
    ['0', 0],
    [' 47.6 ', 47.6],
    ['90', 90],
    ['-90.0', -90],
  ])('§4.1: accepts %j as %d', (input, expected) => {
    expect(parseCoordinate(input)).toBe(expected);
  });

  it.each([
    '',
    'abc',
    '+47.6',
    '.5',
    '5.',
    '1e1',
    '0x10',
    '47,6',
    'NaN',
    'Infinity',
  ])('§4.1: rejects %j', (input) => {
    expect(parseCoordinate(input)).toBeNull();
  });

  it('§4.1: does not range-check (that is validateQuery’s job)', () => {
    expect(parseCoordinate('999')).toBe(999);
  });
});
