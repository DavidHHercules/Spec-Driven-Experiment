import { describe, expect, it } from 'vitest';
import { parseCoordinate, validateQuery } from '../src/core/validate';

const q = (s: string) => new URLSearchParams(s);
const ok = (lat: number, lon: number) => ({ ok: true, lat, lon });
const fail = (code: string) => expect.objectContaining({ ok: false, code });

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

describe('validateQuery', () => {
  it('R1 (input side): valid lat and lon → ok with parsed numbers', () => {
    expect(validateQuery(q('lat=47.6&lon=-122.3'))).toStrictEqual(ok(47.6, -122.3));
  });

  it('R2: missing lat → MISSING_LAT', () => {
    expect(validateQuery(q('lon=2'))).toEqual(fail('MISSING_LAT'));
  });

  it('R3: missing lon → MISSING_LON', () => {
    expect(validateQuery(q('lat=1'))).toEqual(fail('MISSING_LON'));
  });

  it.each(['lat=abc&lon=2', 'lat=&lon=2', 'lat=1e1&lon=2'])('R4: %s → INVALID_LAT', (s) => {
    expect(validateQuery(q(s))).toEqual(fail('INVALID_LAT'));
  });

  it.each(['lat=1&lon=abc', 'lat=1&lon=', 'lat=1&lon=0x10'])('R5: %s → INVALID_LON', (s) => {
    expect(validateQuery(q(s))).toEqual(fail('INVALID_LON'));
  });

  it.each(['90.0001', '-91', '999'])('R6: lat=%s (out of range) → INVALID_LAT', (lat) => {
    expect(validateQuery(q(`lat=${lat}&lon=0`))).toEqual(fail('INVALID_LAT'));
  });

  it.each([
    ['90', 90],
    ['-90', -90],
  ])('R6: lat=%s (boundary) → ok', (lat, n) => {
    expect(validateQuery(q(`lat=${lat}&lon=0`))).toStrictEqual(ok(n, 0));
  });

  it.each(['180.5', '-181'])('R7: lon=%s (out of range) → INVALID_LON', (lon) => {
    expect(validateQuery(q(`lat=0&lon=${lon}`))).toEqual(fail('INVALID_LON'));
  });

  it.each([
    ['180', 180],
    ['-180', -180],
  ])('R7: lon=%s (boundary) → ok', (lon, n) => {
    expect(validateQuery(q(`lat=0&lon=${lon}`))).toStrictEqual(ok(0, n));
  });

  it.each([
    ['', 'MISSING_LAT'],
    ['lat=abc&lon=abc', 'INVALID_LAT'],
    ['lat=999', 'INVALID_LAT'],
    ['lat=1', 'MISSING_LON'],
    ['lon=abc', 'MISSING_LAT'],
  ])('R8: %j reports only the first problem → %s', (s, code) => {
    expect(validateQuery(q(s))).toEqual(fail(code));
  });

  it('R4/R5: error message is a non-empty human-readable string', () => {
    const result = validateQuery(q('lat=abc&lon=0'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
  });

  it('R19: unknown params are ignored', () => {
    expect(validateQuery(q('lat=1&lon=2&foo=bar&lat_extra=x'))).toStrictEqual(ok(1, 2));
  });

  it('R21: duplicate lat → first wins', () => {
    expect(validateQuery(q('lat=1&lat=50&lon=2'))).toStrictEqual(ok(1, 2));
  });

  it('R21: later duplicates are not validated', () => {
    expect(validateQuery(q('lat=1&lat=abc&lon=2&lon=999'))).toStrictEqual(ok(1, 2));
  });
});
