import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKOFF_MS, isTransient, runWithRetries } from '../src/core/retry';
import type { AttemptOutcome } from '../src/core/types';

const OK: AttemptOutcome = {
  kind: 'ok',
  data: { tempC: 1, windKph: 2, weatherCode: 0, observedAt: '2026-11-08T00:00' },
};
const TIMEOUT: AttemptOutcome = { kind: 'timeout', timeoutMs: 2000 };
const NETWORK: AttemptOutcome = { kind: 'network', detail: 'TypeError: fetch failed' };
const status = (s: number): AttemptOutcome => ({ kind: 'status', status: s, detail: 'body=""' });
const BAD: AttemptOutcome = { kind: 'bad-response', detail: 'weather_code is not an integer' };

/** Attempt function that returns scripted outcomes in order and counts calls. */
function scripted(...outcomes: AttemptOutcome[]) {
  const state = { calls: 0 };
  const attempt = async () => outcomes[state.calls++] ?? OK;
  return { attempt, state };
}

/** Runs to completion, letting all backoff timers fire. Returns result + elapsed fake time. */
async function runAll(attempt: () => Promise<AttemptOutcome>, maxAttempts: number, log = (_: string) => {}) {
  const t0 = Date.now();
  const p = runWithRetries(attempt, maxAttempts, log);
  await vi.runAllTimersAsync();
  const result = await p;
  return { ...result, elapsedMs: Date.now() - t0 };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('isTransient', () => {
  it.each([
    ['network', NETWORK],
    ['timeout', TIMEOUT],
    ['status 500', status(500)],
    ['status 502', status(502)],
    ['status 503', status(503)],
    ['status 504', status(504)],
  ])('R25: %s is transient', (_label, o) => {
    expect(isTransient(o)).toBe(true);
  });

  it.each([
    ['status 429', status(429)],
    ['status 404', status(404)],
    ['status 400', status(400)],
    ['status 501', status(501)],
    ['bad-response', BAD],
    ['ok', OK],
  ])('R26: %s is not transient', (_label, o) => {
    expect(isTransient(o)).toBe(false);
  });
});

describe('runWithRetries', () => {
  it.each([
    ['network', NETWORK],
    ['timeout', TIMEOUT],
    ['status 503', status(503)],
  ])('R25: %s then ok → retried and succeeds on attempt 2', async (_label, first) => {
    const { attempt, state } = scripted(first, OK);
    const r = await runAll(attempt, 3);
    expect(r.outcome).toBe(OK);
    expect(r.attempts).toBe(2);
    expect(state.calls).toBe(2);
  });

  it.each([
    ['status 429', status(429)],
    ['status 404', status(404)],
    ['bad-response', BAD],
  ])('R26: %s → not retried (1 attempt, no waiting)', async (_label, first) => {
    const { attempt, state } = scripted(first, OK);
    const r = await runAll(attempt, 3);
    expect(r.outcome).toBe(first);
    expect(state.calls).toBe(1);
    expect(r.elapsedMs).toBe(0);
  });

  it('R27: backoff is exact — attempt 2 at 250 ms (not 249), attempt 3 at +500 ms (not +499)', async () => {
    const { attempt, state } = scripted(NETWORK, NETWORK, OK);
    const p = runWithRetries(attempt, 3, () => {});

    await vi.advanceTimersByTimeAsync(0);
    expect(state.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(state.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.calls).toBe(2);
    await vi.advanceTimersByTimeAsync(499);
    expect(state.calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.calls).toBe(3);

    expect((await p).outcome).toBe(OK);
  });

  it('R27: backoff constants are 250 / 500 / 1000 ms', () => {
    expect(BACKOFF_MS).toStrictEqual([250, 500, 1000]);
  });

  it.each([
    [1, 0],
    [2, 250],
    [3, 750],
    [4, 1750],
  ])('R27/R23: max attempts %i → stops there; total backoff %i ms', async (max, expectedWait) => {
    const { attempt, state } = scripted(NETWORK, NETWORK, NETWORK, NETWORK, NETWORK);
    const r = await runAll(attempt, max);
    expect(state.calls).toBe(max);
    expect(r.attempts).toBe(max);
    expect(r.elapsedMs).toBe(expectedWait);
  });

  it('R28: success on attempt 2 → no attempt 3', async () => {
    const { attempt, state } = scripted(status(502), OK, NETWORK);
    const r = await runAll(attempt, 3);
    expect(r.outcome).toBe(OK);
    expect(state.calls).toBe(2);
  });

  it('R29: last attempt wins — timeout, timeout, 503 → 503', async () => {
    const last = status(503);
    const { attempt } = scripted(TIMEOUT, TIMEOUT, last);
    const r = await runAll(attempt, 3);
    expect(r.outcome).toBe(last);
  });

  it('R29: last attempt wins — 503, then permanent bad-response → bad-response', async () => {
    const { attempt } = scripted(status(503), BAD);
    const r = await runAll(attempt, 3);
    expect(r.outcome).toBe(BAD);
    expect(r.attempts).toBe(2);
  });

  it('R30: each failed attempt logs number, max, kind, detail, and what happens next', async () => {
    const lines: string[] = [];
    const { attempt } = scripted(TIMEOUT, status(503), NETWORK);
    await runAll(attempt, 3, (m) => lines.push(m));

    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/attempt 1\/3 failed: timeout after 2000ms; retrying in 250ms/);
    expect(lines[1]).toMatch(/attempt 2\/3 failed: status 503 .*; retrying in 500ms/);
    expect(lines[2]).toMatch(/attempt 3\/3 failed: network TypeError: fetch failed; giving up/);
  });

  it('R30: a permanent failure logs "giving up" immediately', async () => {
    const lines: string[] = [];
    const { attempt } = scripted(status(429));
    await runAll(attempt, 3, (m) => lines.push(m));
    expect(lines).toEqual([expect.stringMatching(/attempt 1\/3 failed: status 429 .*; giving up/)]);
  });

  it('R30: success logs nothing (the caller logs success)', async () => {
    const lines: string[] = [];
    const { attempt } = scripted(OK);
    await runAll(attempt, 3, (m) => lines.push(m));
    expect(lines).toEqual([]);
  });
});
