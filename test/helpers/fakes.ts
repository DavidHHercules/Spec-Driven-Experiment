import type { Deps } from '../../src/core/types';

/** One scripted upstream outcome. */
export type FetchStep =
  | { status: number; json: unknown }                // body serialized as JSON
  | { status: number; text: string }                 // raw body (e.g. invalid JSON)
  | { throws: Error }                                // network-level failure
  | { hang: true }                                   // never responds until the signal aborts
  | { status: number; hangBody: true }               // headers arrive, body never ends until aborted
  | { status: number; bodyError: Error };            // body stream fails mid-read (F4)

/** One recorded call. `aborted` reads the request's signal at assertion time (N6). */
export interface FetchCall {
  url: string;
  readonly aborted: boolean;
}

const abortError = () => new DOMException('This operation was aborted', 'AbortError');

/**
 * Fake fetch (N1): never touches the network. Returns scripted responses in order
 * and records every call. Honors `init.signal` like real fetch does.
 */
export function fakeFetch(...steps: FetchStep[]) {
  const calls: FetchCall[] = [];
  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal ?? undefined;
    calls.push({ url: String(input), get aborted() { return signal?.aborted ?? false; } });
    const step = steps[calls.length - 1];
    if (!step) throw new Error(`fakeFetch: unexpected call #${calls.length}`);
    if ('throws' in step) throw step.throws;

    if ('hang' in step) {
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => reject(abortError()));
      });
    }

    if ('hangBody' in step) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener('abort', () => controller.error(abortError()));
        },
      });
      return new Response(body, { status: step.status });
    }

    if ('bodyError' in step) {
      const err = step.bodyError;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"current":'));
          controller.error(err);
        },
      });
      return new Response(body, { status: step.status });
    }

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
  const warn: string[] = [];
  const error: string[] = [];
  return {
    info,
    warn,
    error,
    log: {
      info: (m: string) => info.push(m),
      warn: (m: string) => warn.push(m),
      error: (m: string) => error.push(m),
    },
  };
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
    // Single attempt by default, so Spec 001 tests keep testing exactly what they always did.
    // Spec 002 tests opt into retries explicitly.
    settings: { UPSTREAM_MAX_ATTEMPTS: '1' },
    log: logger.log,
  };
  return { deps, calls: f.calls, logs: logger };
}
