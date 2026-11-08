const DEFAULT_BASE_URL = 'https://api.open-meteo.com';
const CURRENT_FIELDS = 'temperature_2m,wind_speed_10m,weather_code';

export type ParsedCurrent =
  | { ok: true; tempC: number; windKph: number; weatherCode: number; observedAt: string }
  | { ok: false; reason: string };

/** R11 / D7: unset or empty → default; trailing slashes removed. */
export function resolveBaseUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_BASE_URL;
  return value.replace(/\/+$/, '');
}

/**
 * R10: forecast URL for current temperature, wind, and weather code.
 * Coordinates are passed through unrounded (D4). Query values are set via
 * URLSearchParams, so they are always correctly encoded.
 */
export function buildForecastUrl(baseUrl: string, lat: number, lon: number): string {
  const url = new URL(`${baseUrl}/v1/forecast`);
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('current', CURRENT_FIELDS);
  return url.toString();
}

/**
 * R12 / R17: extracts and type-checks the fields we use from an Open-Meteo response.
 * The input is `unknown` on purpose: upstream JSON is untrusted until checked.
 */
export function parseCurrent(json: unknown): ParsedCurrent {
  if (!isObject(json)) return fail('body is not a JSON object');

  const current = json['current'];
  if (!isObject(current)) return fail('"current" is missing or not an object');

  const temp = current['temperature_2m'];
  const wind = current['wind_speed_10m'];
  const code = current['weather_code'];
  const time = current['time'];

  if (!isFiniteNumber(temp)) return fail(`temperature_2m is not a finite number: ${show(temp)}`);
  if (!isFiniteNumber(wind)) return fail(`wind_speed_10m is not a finite number: ${show(wind)}`);
  if (!Number.isInteger(code)) return fail(`weather_code is not an integer: ${show(code)}`);
  if (typeof time !== 'string' || time === '') return fail(`time is not a non-empty string: ${show(time)}`);

  return { ok: true, tempC: temp, windKph: wind, weatherCode: code as number, observedAt: time };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function fail(reason: string): ParsedCurrent {
  return { ok: false, reason };
}

function show(v: unknown): string {
  return v === undefined ? 'missing' : JSON.stringify(v);
}
