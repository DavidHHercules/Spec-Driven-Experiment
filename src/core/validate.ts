import type { ErrorCode } from './types';

export type ValidationResult =
  | { ok: true; lat: number; lon: number }
  | { ok: false; code: ErrorCode; message: string };

type FieldResult = { ok: true; value: number } | { ok: false; code: ErrorCode; message: string };

/** Spec 001 R6, R7: valid ranges are -LIMIT..LIMIT inclusive. */
export const LAT_LIMIT = 90;
export const LON_LIMIT = 180;

/** Spec §4.1: optional '-', digits, optional '.' followed by digits. */
const COORDINATE_FORMAT = /^-?\d+(\.\d+)?$/;

/**
 * Parses a raw query value per spec §4.1. Returns null if the format is not accepted.
 * Does NOT check ranges.
 *
 * The regex runs before Number() on purpose (D2): Number('') is 0 and Number('0x10') is 16.
 */
export function parseCoordinate(raw: string): number | null {
  const trimmed = raw.trim();
  if (!COORDINATE_FORMAT.test(trimmed)) {
    return null;
  }
  return Number(trimmed);
}

/**
 * Validates the request query (R2–R8, R19, R21).
 * Only `lat` and `lon` are read; other params are ignored (R19).
 * `get` returns the first occurrence, so later duplicates are ignored (R21).
 * `lat` is fully checked before `lon`, and only the first problem is reported (R8).
 */
export function validateQuery(q: URLSearchParams): ValidationResult {
  const lat = checkField(q, 'lat', LAT_LIMIT, 'MISSING_LAT', 'INVALID_LAT');
  if (!lat.ok) return lat;

  const lon = checkField(q, 'lon', LON_LIMIT, 'MISSING_LON', 'INVALID_LON');
  if (!lon.ok) return lon;

  return { ok: true, lat: lat.value, lon: lon.value };
}

function checkField(
  q: URLSearchParams,
  name: 'lat' | 'lon',
  limit: number,
  missingCode: ErrorCode,
  invalidCode: ErrorCode,
): FieldResult {
  const raw = q.get(name);
  if (raw === null) {
    return { ok: false, code: missingCode, message: `${name} is required` };
  }

  const value = parseCoordinate(raw);
  if (value === null || value < -limit || value > limit) {
    return {
      ok: false,
      code: invalidCode,
      message: `${name} must be a number between -${limit} and ${limit}`,
    };
  }

  return { ok: true, value };
}
