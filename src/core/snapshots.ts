import { resolveResilienceConfig, type ResilienceConfig } from './config';
import { describeError, describeOutcome } from './fetchAttempt';
import { getCurrentWeather } from './getCurrentWeather';
import { parseLocations, type Location } from './locations';
import type { Deps } from './types';
import { describeWeatherCode } from './weatherCodes';

/** R34 / D17: every 30 minutes at :00 and :30 UTC (NCRONTAB, six fields). */
export const SNAPSHOT_SCHEDULE = '0 */30 * * * *';

/** Table name (spec 003 R43). */
export const SNAPSHOT_TABLE = 'weathersnapshots';

/** One stored record (spec 003 §5). */
export interface Snapshot {
  locationId: string;
  lat: number;
  lon: number;
  observedAt: string;
  fetchedAt: string;
  tempC: number;
  windKph: number;
  weatherCode: number;
  condition: string;
}

/** Where snapshots go. Injected so the core never imports a storage SDK (N8). */
export interface SnapshotStore {
  /** Insert or overwrite by identity (locationId, observedAt) — R44. */
  upsert(snapshot: Snapshot): Promise<void>;
}

/** Outcome of one run (R48). */
export interface RunSummary {
  saved: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

/** Thrown when every attempted location failed (R46), so the platform records a failed run. */
export class SnapshotRunFailedError extends Error {
  constructor(public readonly summary: RunSummary) {
    super(`snapshots run failed: all ${summary.failed} attempted location(s) failed`);
    this.name = 'SnapshotRunFailedError';
  }
}

/**
 * One scheduled run (spec 003). Knows nothing about Azure or Table Storage (N2, N8):
 * the timer adapter supplies `isPastDue`, and storage comes in as `deps.store`.
 */
export async function runSnapshots(
  deps: Deps & { store: SnapshotStore },
  opts: { isPastDue: boolean },
): Promise<RunSummary> {
  const startedAt = deps.now();

  // R35 / D22: late runs proceed normally; there is no way to catch up on past weather.
  if (opts.isPastDue) deps.log.warn('snapshots: run is past due (started late); proceeding normally');

  // R36–R40
  const parsed = parseLocations(deps.settings['SNAPSHOT_LOCATIONS']);
  for (const w of parsed.warnings) deps.log.warn(w);

  // Spec 002 R32/R33: resolved once per run, so warnings appear once — not once per location.
  const { config, warnings } = resolveResilienceConfig(deps.settings);
  for (const w of warnings) deps.log.warn(w);

  let saved = 0;
  let failed = 0;

  if (parsed.locations.length === 0) {
    deps.log.warn('snapshots: no valid locations configured in SNAPSHOT_LOCATIONS; nothing to do'); // R39
  } else {
    // R42: all locations concurrently. processLocation never rejects, so one failure
    // cannot short-circuit Promise.all or affect other locations (R45).
    const results = await Promise.all(parsed.locations.map((loc) => processLocation(loc, config, deps)));
    saved = results.filter(Boolean).length;
    failed = results.length - saved;
  }

  const summary: RunSummary = {
    saved,
    failed,
    skipped: parsed.skipped,
    durationMs: deps.now().getTime() - startedAt.getTime(),
  };

  // R48: always log the summary — including before failing the run.
  deps.log.info(
    `snapshots run: saved=${summary.saved} failed=${summary.failed} skipped=${summary.skipped} durationMs=${summary.durationMs}`,
  );

  // R46 / R47 / D18: fail only if something was attempted and nothing succeeded.
  if (parsed.locations.length > 0 && saved === 0) throw new SnapshotRunFailedError(summary);

  return summary;
}

/** Fetch + store one location. Returns true if saved. Never throws (R45). */
async function processLocation(
  loc: Location,
  config: ResilienceConfig,
  deps: Deps & { store: SnapshotStore },
): Promise<boolean> {
  // R41 / N7: exactly the HTTP endpoint's upstream behavior.
  const { outcome, finishedAt } = await getCurrentWeather(
    loc.lat,
    loc.lon,
    config,
    deps,
    `snapshots upstream location=${loc.id}`,
  );

  if (outcome.kind !== 'ok') {
    deps.log.error(`snapshots location=${loc.id} failed: ${describeOutcome(outcome)}`);
    return false;
  }

  const { data } = outcome;
  const snapshot: Snapshot = {
    locationId: loc.id,
    lat: loc.lat,
    lon: loc.lon,
    observedAt: data.observedAt,
    fetchedAt: finishedAt.toISOString(),
    tempC: data.tempC,
    windKph: data.windKph,
    weatherCode: data.weatherCode,
    condition: describeWeatherCode(data.weatherCode),
  };

  try {
    await deps.store.upsert(snapshot); // R43, R44
    return true;
  } catch (err) {
    deps.log.error(`snapshots location=${loc.id} failed to store: ${describeError(err)}`);
    return false;
  }
}
