import { describe, expect, it } from 'vitest';
import { buildForecastUrl, parseCurrent, resolveBaseUrl } from '../src/core/openMeteo';

const DEFAULT = 'https://api.open-meteo.com';

describe('resolveBaseUrl', () => {
  it('R11: unset → default', () => {
    expect(resolveBaseUrl(undefined)).toBe(DEFAULT);
  });

  it('R11: empty string → default (D7)', () => {
    expect(resolveBaseUrl('')).toBe(DEFAULT);
  });

  it('R11: configured value is used', () => {
    expect(resolveBaseUrl('http://localhost:9999')).toBe('http://localhost:9999');
  });

  it('R11: trailing slash is tolerated (D7)', () => {
    expect(buildForecastUrl(resolveBaseUrl('https://x.com/'), 1, 2)).toBe(
      buildForecastUrl(resolveBaseUrl('https://x.com'), 1, 2),
    );
  });
});

describe('buildForecastUrl', () => {
  const url = new URL(buildForecastUrl(DEFAULT, 47.6, -122.3));

  it('R10: targets the forecast endpoint', () => {
    expect(url.origin).toBe(DEFAULT);
    expect(url.pathname).toBe('/v1/forecast');
  });

  it('R10: sends coordinates and requests the three current fields', () => {
    expect(url.searchParams.get('latitude')).toBe('47.6');
    expect(url.searchParams.get('longitude')).toBe('-122.3');
    expect(url.searchParams.get('current')).toBe('temperature_2m,wind_speed_10m,weather_code');
  });

  it('R10 / D4: coordinates are not rounded', () => {
    const u = new URL(buildForecastUrl(DEFAULT, 47.123456789, -122.987654321));
    expect(u.searchParams.get('latitude')).toBe('47.123456789');
    expect(u.searchParams.get('longitude')).toBe('-122.987654321');
  });
});

describe('parseCurrent', () => {
  const validCurrent = {
    time: '2026-11-07T21:00',
    interval: 900,
    temperature_2m: 12.37,
    wind_speed_10m: 14.2,
    weather_code: 61,
  };
  const body = (current: unknown) => ({ latitude: 47.6, longitude: -122.3, current });

  it('R12: valid body → fields returned unchanged (no rounding)', () => {
    expect(parseCurrent(body(validCurrent))).toStrictEqual({
      ok: true,
      tempC: 12.37,
      windKph: 14.2,
      weatherCode: 61,
      observedAt: '2026-11-07T21:00',
    });
  });

  it('R12: extra unknown fields in current are ignored', () => {
    expect(parseCurrent(body({ ...validCurrent, humidity: 80 })).ok).toBe(true);
  });

  const required = ['temperature_2m', 'wind_speed_10m', 'weather_code', 'time'] as const;

  it.each(required)('R17: missing %s → not ok', (field) => {
    const { [field]: _removed, ...rest } = validCurrent;
    expect(parseCurrent(body(rest)).ok).toBe(false);
  });

  it.each(required)('R17: null %s → not ok', (field) => {
    expect(parseCurrent(body({ ...validCurrent, [field]: null })).ok).toBe(false);
  });

  it.each([
    ['temperature_2m', '12'],
    ['wind_speed_10m', true],
    ['weather_code', 61.5],
    ['weather_code', 'rain'],
    ['time', ''],
    ['time', 1730000000],
  ])('R17: %s = %j (wrong type) → not ok', (field, value) => {
    expect(parseCurrent(body({ ...validCurrent, [field]: value })).ok).toBe(false);
  });

  it.each([
    ['current missing', { latitude: 1 }],
    ['current is null', body(null)],
    ['current is an array', body([])],
    ['body is null', null],
    ['body is an array', []],
    ['body is a string', 'ok'],
  ])('R17: %s → not ok', (_label, json) => {
    expect(parseCurrent(json).ok).toBe(false);
  });

  it('R17: failure includes a reason (for logging, R18)', () => {
    const result = parseCurrent(body({ ...validCurrent, weather_code: 'rain' }));
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('weather_code') });
  });
});
