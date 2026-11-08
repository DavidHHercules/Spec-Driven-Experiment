import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAttemptOnce } from '../src/core/fetchAttempt';
import { fakeFetch, upstreamBody } from './helpers/fakes';

const URL = 'https://api.open-meteo.com/v1/forecast?latitude=1&longitude=2';

/** Starts an attempt and tracks whether it has settled, so tests can check "not yet". */
function start(promise: Promise<unknown>) {
  const state = { settled: false };
  promise.then(() => (state.settled = true));
  return state;
}

describe('fetchAttemptOnce — timeout (fake timers)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('R22: hanging request → timeout exactly at the limit, not before', async () => {
    const f = fakeFetch({ hang: true });
    const p = fetchAttemptOnce(f.fetch, URL, 2000);
    const state = start(p);

    await vi.advanceTimersByTimeAsync(1999);
    expect(state.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(state.settled).toBe(true);
    expect(await p).toStrictEqual({ kind: 'timeout', timeoutMs: 2000 });
  });

  it('R22: headers arrive but body never ends → timeout (limit covers the body read)', async () => {
    const f = fakeFetch({ status: 200, hangBody: true });
    const p = fetchAttemptOnce(f.fetch, URL, 500);

    await vi.advanceTimersByTimeAsync(500);

    expect(await p).toStrictEqual({ kind: 'timeout', timeoutMs: 500 });
  });

  it('N6: the abandoned request is actually aborted', async () => {
    const f = fakeFetch({ hang: true });
    const p = fetchAttemptOnce(f.fetch, URL, 2000);

    await vi.advanceTimersByTimeAsync(2000);
    await p;

    expect(f.calls[0]!.aborted).toBe(true);
  });

  it('N6: a fast success leaves no timer behind and is not aborted', async () => {
    const f = fakeFetch({ status: 200, json: upstreamBody() });

    const outcome = await fetchAttemptOnce(f.fetch, URL, 2000);

    expect(outcome.kind).toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
    expect(f.calls[0]!.aborted).toBe(false);
  });
});

describe('fetchAttemptOnce — classification', () => {
  it('ok: returns the parsed weather data', async () => {
    const f = fakeFetch({ status: 200, json: upstreamBody() });
    expect(await fetchAttemptOnce(f.fetch, URL, 2000)).toStrictEqual({
      kind: 'ok',
      data: { tempC: 12.4, windKph: 14.2, weatherCode: 61, observedAt: '2026-11-07T21:00' },
    });
  });

  it('network: fetch rejects (not a timeout)', async () => {
    const f = fakeFetch({ throws: new TypeError('fetch failed') });
    expect(await fetchAttemptOnce(f.fetch, URL, 2000)).toMatchObject({ kind: 'network' });
  });

  it('F4: body stream fails mid-read (not a timeout) → network', async () => {
    const f = fakeFetch({ status: 200, bodyError: new Error('socket hang up') });
    const outcome = await fetchAttemptOnce(f.fetch, URL, 2000);
    expect(outcome).toMatchObject({ kind: 'network', detail: expect.stringContaining('socket hang up') });
  });

  it('status: non-2xx keeps the status code', async () => {
    const f = fakeFetch({ status: 503, text: 'busy' });
    expect(await fetchAttemptOnce(f.fetch, URL, 2000)).toMatchObject({ kind: 'status', status: 503 });
  });

  it('bad-response: invalid JSON', async () => {
    const f = fakeFetch({ status: 200, text: 'not json' });
    expect(await fetchAttemptOnce(f.fetch, URL, 2000)).toMatchObject({ kind: 'bad-response' });
  });

  it('bad-response: wrong shape', async () => {
    const f = fakeFetch({ status: 200, json: upstreamBody({ weather_code: 'rain' }) });
    expect(await fetchAttemptOnce(f.fetch, URL, 2000)).toMatchObject({ kind: 'bad-response' });
  });

  it('N6: passes an AbortSignal to fetch', async () => {
    const spy = vi.fn(fakeFetch({ status: 200, json: upstreamBody() }).fetch);
    await fetchAttemptOnce(spy as typeof globalThis.fetch, URL, 2000);
    expect(spy.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
