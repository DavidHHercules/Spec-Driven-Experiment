import { describe, expect, it } from 'vitest';
import { handleWeatherRequest } from '../src/core/handleWeatherRequest';
import { makeDeps, upstreamBody } from './helpers/fakes';

const q = (s: string) => new URLSearchParams(s);

describe('handleWeatherRequest — success path', () => {
  it('R1: valid query + good upstream → 200 with exactly the spec §3 shape', async () => {
    const { deps } = makeDeps({ fetch: [{ status: 200, json: upstreamBody() }] });

    const res = await handleWeatherRequest(q('lat=47.6&lon=-122.3'), deps);

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({
      location: { lat: 47.6, lon: -122.3 },
      tempC: 12.4,
      windKph: 14.2,
      condition: 'Light rain',
      weatherCode: 61,
      observedAt: '2026-11-07T21:00',
      fetchedAt: '2026-11-07T21:14:03.512Z',
    });
  });

  it('R10: calls upstream exactly once with the forecast URL', async () => {
    const { deps, calls } = makeDeps({ fetch: [{ status: 200, json: upstreamBody() }] });

    await handleWeatherRequest(q('lat=47.6&lon=-122.3'), deps);

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!);
    expect(url.pathname).toBe('/v1/forecast');
    expect(url.searchParams.get('latitude')).toBe('47.6');
    expect(url.searchParams.get('longitude')).toBe('-122.3');
  });

  it('R10/R11: uses the injected base URL', async () => {
    const { deps, calls } = makeDeps({ fetch: [{ status: 200, json: upstreamBody() }] });
    deps.baseUrl = 'http://localhost:7777';

    await handleWeatherRequest(q('lat=1&lon=2'), deps);

    expect(calls[0]).toMatch(/^http:\/\/localhost:7777\/v1\/forecast\?/);
  });

  it('R12/R13: values come from upstream unchanged; condition matches the code', async () => {
    const { deps } = makeDeps({
      fetch: [{ status: 200, json: upstreamBody({ temperature_2m: -3.17, wind_speed_10m: 0, weather_code: 75 }) }],
    });

    const res = await handleWeatherRequest(q('lat=1&lon=2'), deps);

    expect(res.body).toMatchObject({ tempC: -3.17, windKph: 0, weatherCode: 75, condition: 'Snow' });
  });

  it('R14: unknown integer code → 200 with condition "Unknown"', async () => {
    const { deps } = makeDeps({ fetch: [{ status: 200, json: upstreamBody({ weather_code: 42 }) }] });

    const res = await handleWeatherRequest(q('lat=1&lon=2'), deps);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ weatherCode: 42, condition: 'Unknown' });
  });

  it('§3: location echoes the parsed numbers, not the raw strings', async () => {
    const { deps } = makeDeps({ fetch: [{ status: 200, json: upstreamBody() }] });

    const res = await handleWeatherRequest(q('lat=%2047.6%20&lon=-122.30'), deps);

    expect(res.body).toMatchObject({ location: { lat: 47.6, lon: -122.3 } });
  });

  it('§3: fetchedAt is the clock time after the upstream response, ISO 8601 UTC', async () => {
    const { deps } = makeDeps({
      fetch: [{ status: 200, json: upstreamBody() }],
      clock: ['2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.500Z'],
    });

    const res = await handleWeatherRequest(q('lat=1&lon=2'), deps);

    expect(res.body).toMatchObject({ fetchedAt: '2026-01-01T00:00:01.500Z' });
  });

  it('N3: logs exactly one info line with lat, lon, and upstream duration in ms', async () => {
    const { deps, logs } = makeDeps({
      fetch: [{ status: 200, json: upstreamBody() }],
      clock: ['2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.250Z'],
    });

    await handleWeatherRequest(q('lat=47.6&lon=-122.3'), deps);

    expect(logs.info).toHaveLength(1);
    expect(logs.info[0]).toContain('lat=47.6');
    expect(logs.info[0]).toContain('lon=-122.3');
    expect(logs.info[0]).toContain('upstreamMs=250');
    expect(logs.error).toHaveLength(0);
  });
});
