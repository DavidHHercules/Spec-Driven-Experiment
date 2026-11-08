import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/v1/forecast');
    expect(url.searchParams.get('latitude')).toBe('47.6');
    expect(url.searchParams.get('longitude')).toBe('-122.3');
  });

  it('R10/R11: uses the injected base URL', async () => {
    const { deps, calls } = makeDeps({ fetch: [{ status: 200, json: upstreamBody() }] });
    deps.settings = { ...deps.settings, OPEN_METEO_BASE_URL: 'http://localhost:7777' };

    await handleWeatherRequest(q('lat=1&lon=2'), deps);

    expect(calls[0]!.url).toMatch(/^http:\/\/localhost:7777\/v1\/forecast\?/);
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

describe('handleWeatherRequest — failure paths', () => {
  it.each([
    ['', 'MISSING_LAT'],
    ['lat=1', 'MISSING_LON'],
    ['lat=999&lon=0', 'INVALID_LAT'],
    ['lat=0&lon=abc', 'INVALID_LON'],
  ])('R9: invalid query %j → 400 %s and upstream is never called', async (s, code) => {
    const { deps, calls } = makeDeps({ fetch: [] });

    const res = await handleWeatherRequest(q(s), deps);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code } });
    expect(calls).toHaveLength(0);
  });

  it.each([500, 503, 404, 429])('R15: upstream %i → 502 UPSTREAM_ERROR', async (status) => {
    const { deps } = makeDeps({ fetch: [{ status, text: 'upstream says no' }] });

    const res = await handleWeatherRequest(q('lat=1&lon=2'), deps);

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: { code: 'UPSTREAM_ERROR' } });
  });

  it('R16: network failure (fetch rejects) → 502 UPSTREAM_ERROR', async () => {
    const { deps } = makeDeps({ fetch: [{ throws: new TypeError('fetch failed: ECONNREFUSED') }] });

    const res = await handleWeatherRequest(q('lat=1&lon=2'), deps);

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: { code: 'UPSTREAM_ERROR' } });
  });

  it('R17: upstream 200 with invalid JSON → 502 UPSTREAM_BAD_RESPONSE', async () => {
    const { deps } = makeDeps({ fetch: [{ status: 200, text: '<html>not json</html>' }] });

    const res = await handleWeatherRequest(q('lat=1&lon=2'), deps);

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: { code: 'UPSTREAM_BAD_RESPONSE' } });
  });

  it('R17: upstream 200 with wrong shape → 502 UPSTREAM_BAD_RESPONSE', async () => {
    const { deps } = makeDeps({ fetch: [{ status: 200, json: upstreamBody({ weather_code: 'rain' }) }] });

    const res = await handleWeatherRequest(q('lat=1&lon=2'), deps);

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: { code: 'UPSTREAM_BAD_RESPONSE' } });
  });

  // R18: one case per failure kind. The secret detail must reach the log, never the response.
  it.each([
    ['non-2xx', { status: 500, text: 'SECRET-DETAIL internal stack' }],
    ['network', { throws: new Error('SECRET-DETAIL connection reset') }],
    ['invalid JSON', { status: 200, text: 'SECRET-DETAIL not json' }],
    ['bad shape', { status: 200, json: upstreamBody({ temperature_2m: 'SECRET-DETAIL' }) }],
  ] as const)('R18: %s failure → detail is logged but not returned', async (_kind, step) => {
    const { deps, logs } = makeDeps({ fetch: [step] });

    const res = await handleWeatherRequest(q('lat=1&lon=2'), deps);

    expect(res.status).toBe(502);
    expect(logs.error.join('\n')).toContain('SECRET-DETAIL');
    expect(JSON.stringify(res.body)).not.toContain('SECRET-DETAIL');
  });

  it('R18: network failure log includes the underlying cause (Node fetch wraps it)', async () => {
    const err = new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:1') });
    const { deps, logs } = makeDeps({ fetch: [{ throws: err }] });

    await handleWeatherRequest(q('lat=1&lon=2'), deps);

    expect(logs.error.join('\n')).toContain('ECONNREFUSED');
  });

  it('R18: non-2xx status code is included in the log', async () => {
    const { deps, logs } = makeDeps({ fetch: [{ status: 503, text: '' }] });

    await handleWeatherRequest(q('lat=1&lon=2'), deps);

    expect(logs.error.join('\n')).toContain('503');
  });

  it('N3: no success line is logged on failure', async () => {
    const { deps, logs } = makeDeps({ fetch: [{ status: 500, text: '' }] });

    await handleWeatherRequest(q('lat=1&lon=2'), deps);

    expect(logs.info).toHaveLength(0);
  });
});

describe('handleWeatherRequest — timeouts (spec 002)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('R24: final outcome timeout → 504 UPSTREAM_TIMEOUT, detail only in logs', async () => {
    const { deps, logs } = makeDeps({ fetch: [{ hang: true }] });

    const p = handleWeatherRequest(q('lat=1&lon=2'), deps);
    await vi.advanceTimersByTimeAsync(2000);
    const res = await p;

    expect(res.status).toBe(504);
    expect(res.body).toMatchObject({ error: { code: 'UPSTREAM_TIMEOUT' } });
    expect(logs.error.join('\n')).toContain('timeout after 2000ms');
  });
});

describe('handleWeatherRequest — configuration (spec 002)', () => {
  it('R33: invalid setting → warning logged, request still succeeds', async () => {
    const { deps, logs } = makeDeps({ fetch: [{ status: 200, json: upstreamBody() }] });
    deps.settings = { ...deps.settings, UPSTREAM_TIMEOUT_MS: 'abc' };

    const res = await handleWeatherRequest(q('lat=1&lon=2'), deps);

    expect(res.status).toBe(200);
    expect(logs.warn).toHaveLength(1);
    expect(logs.warn[0]).toContain('UPSTREAM_TIMEOUT_MS');
  });

  it('R32: configured timeout is used', async () => {
    vi.useFakeTimers();
    try {
      const { deps } = makeDeps({ fetch: [{ hang: true }] });
      deps.settings = { ...deps.settings, UPSTREAM_TIMEOUT_MS: '300' };
      const p = handleWeatherRequest(q('lat=1&lon=2'), deps);
      await vi.advanceTimersByTimeAsync(300);
      expect((await p).status).toBe(504);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('handleWeatherRequest — configuration warnings on every invocation', () => {
  it('R33: warning is logged even when the query is invalid', async () => {
    const { deps, logs } = makeDeps({ fetch: [] });
    deps.settings = { ...deps.settings, UPSTREAM_MAX_ATTEMPTS: 'lots' };

    const res = await handleWeatherRequest(q('lat=abc'), deps);

    expect(res.status).toBe(400);
    expect(logs.warn.join('\n')).toContain('UPSTREAM_MAX_ATTEMPTS');
  });
});
