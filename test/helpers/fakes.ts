import type { Deps } from '../../src/core/types';

/** One scripted upstream outcome. */
export type FetchStep =
  | { status: number; json: unknown }   // body serialized as JSON
  | { status: number; text: string }    // raw body (e.g. invalid JSON)
  | { throws: Error };                  // network-level failure

/**
 * Fake fetch (N1): never touches the network. Returns scripted responses in order
 * and records every URL it was called with.
 */
export function fakeFetch(...steps: FetchStep[]) {
  const calls: string[] = [];
  const fn = async (input: string | URL | Request): Promise<Response> => {
    calls.push(String(input));
    const step = steps[calls.length - 1];
    if (!step) throw new Error(`fakeFetch: unexpected call #${calls.length}`);
    if ('throws' in step) throw step.throws;
    const body = 'json' in step ? JSON.stringify(step.json) : step.text;
    return new Response(body, { status: step.status });
  };
  return { fetch: fn as typeof globalThis.fetch, calls };
}

/** Fake clock: returns the given dates in order; repeats the last one. */
export function fakeClock(...isoDates: string[]) {
  let i = 0;
  return () => new Date(isoDates[Math.min(i++, isoDates.length - 1)]!);
}

/** Fake logger: captures lines so tests can assert on them. */
export function fakeLogger() {
  const info: string[] = [];
  const error: string[] = [];
  return { info, error, log: { info: (m: string) => info.push(m), error: (m: string) => error.push(m) } };
}

/** A valid Open-Meteo body, overridable per test. */
export function upstreamBody(current: Record<string, unknown> = {}) {
  return {
    latitude: 47.6,
    longitude: -122.3,
    current: {
      time: '2026-11-07T21:00',
      interval: 900,
      temperature_2m: 12.4,
      wind_speed_10m: 14.2,
      weather_code: 61,
      ...current,
    },
  };
}

/** Builds a full Deps object from fakes, with sensible defaults. */
export function makeDeps(overrides: { fetch: FetchStep[]; clock?: string[] }) {
  const f = fakeFetch(...overrides.fetch);
  const logger = fakeLogger();
  const deps: Deps = {
    fetch: f.fetch,
    now: fakeClock(...(overrides.clock ?? ['2026-11-07T21:14:03.262Z', '2026-11-07T21:14:03.512Z'])),
    baseUrl: 'https://api.open-meteo.com',
    log: logger.log,
  };
  return { deps, calls: f.calls, logs: logger };
}
