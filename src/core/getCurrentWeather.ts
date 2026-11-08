import type { ResilienceConfig } from './config';
import { fetchAttemptOnce } from './fetchAttempt';
import { buildForecastUrl, resolveBaseUrl } from './openMeteo';
import { runWithRetries } from './retry';
import type { AttemptOutcome, Deps } from './types';

/**
 * Fetches current weather for one coordinate pair with the full Spec 001/002 behavior:
 * base URL from settings (R11), URL building (R10), per-attempt timeout (R22), retries with
 * backoff (R25–R30). Shared by every function that calls Open-Meteo (Spec 003 N7).
 *
 * `config` is passed in rather than resolved here so callers control when R33 warnings are
 * logged (the HTTP endpoint logs them before query validation).
 */
export async function getCurrentWeather(
  lat: number,
  lon: number,
  config: ResilienceConfig,
  deps: Deps,
  logPrefix: string,
): Promise<{ outcome: AttemptOutcome; attempts: number; startedAt: Date; finishedAt: Date }> {
  const url = buildForecastUrl(resolveBaseUrl(deps.settings['OPEN_METEO_BASE_URL']), lat, lon);

  const startedAt = deps.now();
  const { outcome, attempts } = await runWithRetries(
    () => fetchAttemptOnce(deps.fetch, url, config.timeoutMs),
    config.maxAttempts,
    (msg) => deps.log.error(`${logPrefix} ${msg}`),
  );
  const finishedAt = deps.now();

  return { outcome, attempts, startedAt, finishedAt };
}
