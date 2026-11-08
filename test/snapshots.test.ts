import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSnapshots, SNAPSHOT_SCHEDULE, SnapshotRunFailedError } from '../src/core/snapshots';
import type { Deps } from '../src/core/types';
import { fakeFetchByLat, fakeLogger, fakeStore, upstreamBody, type FetchStep } from './helpers/fakes';

const SEA = 'seattle=47.6,-122.3';
const LON = 'london=51.5,-0.1';
const ok = (current: Record<string, unknown> = {}): FetchStep => ({ status: 200, json: upstreamBody(current) });
const s503: FetchStep = { status: 503, text: '' };

/** Builds deps for a run. Retries default to Spec 002 behavior (3 attempts) unless overridden. */
function setup(opts: {
  locations: string | undefined;
  script: Record<string, FetchStep[]>;
  settings?: Record<string, string>;
  failStoreFor?: string[];
}) {
  const f = fakeFetchByLat(opts.script);
  const logger = fakeLogger();
  const store = fakeStore({ failFor: opts.failStoreFor });
  const settings: Record<string, string | undefined> = { SNAPSHOT_LOCATIONS: opts.locations, ...opts.settings };
  const deps: Deps & { store: typeof store.store } = {
    fetch: f.fetch,
    now: () => new Date(),
    settings,
    log: logger.log,
    store: store.store,
  };
  return { deps, f, logs: logger, store };
}

/** Runs to completion with fake timers (so retries/backoff don't really wait). */
async function run(deps: Parameters<typeof runSnapshots>[0], isPastDue = false) {
  const p = runSnapshots(deps, { isPastDue });
  p.catch(() => {}); // avoid unhandled-rejection noise; assertions await `p` themselves
  await vi.runAllTimersAsync();
  return p;
}

beforeEach(() => vi.useFakeTimers({ now: new Date('2026-11-08T07:00:00.000Z') }));
afterEach(() => vi.useRealTimers());

describe('runSnapshots — success path', () => {
  it('R34: schedule is every 30 minutes at :00 and :30', () => {
    expect(SNAPSHOT_SCHEDULE).toBe('0 */30 * * * *');
  });

  it('R43: each location is stored with all §5 fields', async () => {
    const { deps, store } = setup({
      locations: `${SEA}; ${LON}`,
      script: { '47.6': [ok({ weather_code: 61 })], '51.5': [ok({ weather_code: 3, temperature_2m: 9.1 })] },
    });

    await run(deps);

    expect([...store.records.values()]).toStrictEqual([
      {
        locationId: 'seattle', lat: 47.6, lon: -122.3,
        observedAt: '2026-11-07T21:00', fetchedAt: '2026-11-08T07:00:00.000Z',
        tempC: 12.4, windKph: 14.2, weatherCode: 61, condition: 'Light rain',
      },
      {
        locationId: 'london', lat: 51.5, lon: -0.1,
        observedAt: '2026-11-07T21:00', fetchedAt: '2026-11-08T07:00:00.000Z',
        tempC: 9.1, windKph: 14.2, weatherCode: 3, condition: 'Overcast',
      },
    ]);
  });

  it('R44: same location + same observedAt across two runs → one record (overwritten)', async () => {
    const { deps, store } = setup({ locations: SEA, script: { '47.6': [ok(), ok()] } });

    await run(deps);
    await run(deps);

    expect(store.upserts).toHaveLength(2);
    expect(store.records.size).toBe(1);
  });

  it('R44: a new observedAt → a second record', async () => {
    const { deps, store } = setup({
      locations: SEA,
      script: { '47.6': [ok({ time: '2026-11-08T06:30' }), ok({ time: '2026-11-08T06:45' })] },
    });

    await run(deps);
    await run(deps);

    expect(store.records.size).toBe(2);
  });

  it('R41: Spec 002 retries apply per location (503 then ok → saved after 2 calls)', async () => {
    const { deps, f, store } = setup({ locations: SEA, script: { '47.6': [s503, ok()] } });

    const summary = await run(deps);

    expect(f.callsFor('47.6')).toHaveLength(2);
    expect(store.records.size).toBe(1);
    expect(summary).toMatchObject({ saved: 1, failed: 0 });
  });

  it('R42: locations run concurrently — a location in backoff does not delay another', async () => {
    const { deps, store } = setup({
      locations: `${SEA}; ${LON}`,
      script: { '47.6': [s503, ok()], '51.5': [ok()] },
    });

    const p = runSnapshots(deps, { isPastDue: false });
    await vi.advanceTimersByTimeAsync(0);

    // Seattle is waiting out its 250 ms backoff; London is already saved.
    expect([...store.records.values()].map((r) => r.locationId)).toEqual(['london']);

    await vi.runAllTimersAsync();
    await p;
    expect(store.records.size).toBe(2);
  });

  it.each([undefined, '', '  '])('R39: SNAPSHOT_LOCATIONS=%j → warning, no fetch, resolves', async (raw) => {
    const { deps, f, logs } = setup({ locations: raw, script: {} });

    const summary = await run(deps);

    expect(f.calls).toHaveLength(0);
    expect(logs.warn.join('\n')).toMatch(/no valid locations/i);
    expect(summary).toMatchObject({ saved: 0, failed: 0, skipped: 0 });
  });

  it('R39: only invalid entries → warnings, no fetch, resolves (nothing was attempted)', async () => {
    const { deps, f } = setup({ locations: 'Bad=1,2; worse', script: {} });

    const summary = await run(deps);

    expect(f.calls).toHaveLength(0);
    expect(summary).toMatchObject({ saved: 0, failed: 0, skipped: 2 });
  });

  it('R48: one summary line with saved, failed, skipped, durationMs', async () => {
    const { deps, logs } = setup({ locations: `${SEA}; ${LON}`, script: { '47.6': [ok()], '51.5': [ok()] } });

    await run(deps);

    const summaries = logs.info.filter((l) => l.startsWith('snapshots run:'));
    expect(summaries).toEqual([expect.stringMatching(/^snapshots run: saved=2 failed=0 skipped=0 durationMs=\d+$/)]);
  });
});

describe('runSnapshots — failures and late runs', () => {
  it('R45: one location fails upstream → others saved; failure logged with id and reason', async () => {
    const { deps, store, logs } = setup({
      locations: `${SEA}; ${LON}`,
      script: { '47.6': [{ status: 404, text: 'nope' }], '51.5': [ok()] },
    });

    const summary = await run(deps);

    expect([...store.records.values()].map((r) => r.locationId)).toEqual(['london']);
    expect(summary).toMatchObject({ saved: 1, failed: 1 });
    expect(logs.error.join('\n')).toMatch(/location=seattle.*status 404/);
  });

  it('R45: storing one location fails → others saved; counted as failed and logged', async () => {
    const { deps, store, logs } = setup({
      locations: `${SEA}; ${LON}`,
      script: { '47.6': [ok()], '51.5': [ok()] },
      failStoreFor: ['seattle'],
    });

    const summary = await run(deps);

    expect([...store.records.values()].map((r) => r.locationId)).toEqual(['london']);
    expect(summary).toMatchObject({ saved: 1, failed: 1 });
    expect(logs.error.join('\n')).toMatch(/location=seattle.*simulated storage failure/);
  });

  it('R46: every attempted location fails → throws, after logging the summary', async () => {
    const { deps, logs } = setup({
      locations: `${SEA}; ${LON}`,
      script: { '47.6': [{ status: 404, text: '' }], '51.5': [{ status: 400, text: '' }] },
    });

    await expect(run(deps)).rejects.toBeInstanceOf(SnapshotRunFailedError);
    expect(logs.info.join('\n')).toMatch(/snapshots run: saved=0 failed=2/);
  });

  it('R46: all fail after exhausting retries → throws', async () => {
    const { deps } = setup({ locations: SEA, script: { '47.6': [s503, s503, s503] } });
    await expect(run(deps)).rejects.toBeInstanceOf(SnapshotRunFailedError);
  });

  it('R47: 1 ok + 2 failed → resolves', async () => {
    const { deps } = setup({
      locations: `${SEA}; ${LON}; tokyo=35.6,139.6`,
      script: { '47.6': [ok()], '51.5': [{ status: 404, text: '' }], '35.6': [{ status: 404, text: '' }] },
    });

    await expect(run(deps)).resolves.toMatchObject({ saved: 1, failed: 2 });
  });

  it('R35: past-due run → warning, proceeds normally', async () => {
    const { deps, logs, store } = setup({ locations: SEA, script: { '47.6': [ok()] } });

    await run(deps, true);

    expect(logs.warn.join('\n')).toMatch(/past due/i);
    expect(store.records.size).toBe(1);
  });

  it('R35: on-time run → no past-due warning', async () => {
    const { deps, logs } = setup({ locations: SEA, script: { '47.6': [ok()] } });
    await run(deps, false);
    expect(logs.warn.join('\n')).not.toMatch(/past due/i);
  });

  it('R48: skipped counts invalid and excess config entries', async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `loc${i}=${i + 1},${i + 1}`).join(';');
    const script = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), [ok()]]));
    const { deps, logs } = setup({ locations: `${twelve}; Bad=1,1`, script });

    await run(deps);

    expect(logs.info.join('\n')).toMatch(/saved=10 failed=0 skipped=3/);
  });

  it('R38/R40: config warnings are logged', async () => {
    const { deps, logs } = setup({ locations: `${SEA}; Bad=1,2`, script: { '47.6': [ok()] } });
    await run(deps);
    expect(logs.warn.join('\n')).toContain('"Bad=1,2"');
  });

  it('Spec 002 R33: invalid resilience setting is warned once per run, not once per location', async () => {
    const { deps, logs } = setup({
      locations: `${SEA}; ${LON}`,
      script: { '47.6': [ok()], '51.5': [ok()] },
      settings: { UPSTREAM_TIMEOUT_MS: 'abc' },
    });

    await run(deps);

    expect(logs.warn.filter((w) => w.includes('UPSTREAM_TIMEOUT_MS'))).toHaveLength(1);
  });
});
