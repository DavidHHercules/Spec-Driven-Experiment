import { buildForecastUrl, parseCurrent } from './openMeteo';
import type { CoreResponse, Deps } from './types';
import { validateQuery } from './validate';
import { describeWeatherCode } from './weatherCodes';

/**
 * Core of the weather endpoint (spec 001). Knows nothing about Azure (N2);
 * everything non-deterministic comes in through `deps` (N1).
 */
export async function handleWeatherRequest(q: URLSearchParams, deps: Deps): Promise<CoreResponse> {
  const input = validateQuery(q);
  if (!input.ok) throw new Error('not implemented yet (T10)');

  const { lat, lon } = input;
  const url = buildForecastUrl(deps.baseUrl, lat, lon);

  const startedAt = deps.now();
  const res = await deps.fetch(url);
  const receivedAt = deps.now();

  const parsed = parseCurrent(await res.json());
  if (!parsed.ok) throw new Error('not implemented yet (T10)');

  deps.log.info(
    `weather ok lat=${lat} lon=${lon} upstreamMs=${receivedAt.getTime() - startedAt.getTime()}`,
  );

  return {
    status: 200,
    body: {
      location: { lat, lon },
      tempC: parsed.tempC,
      windKph: parsed.windKph,
      condition: describeWeatherCode(parsed.weatherCode),
      weatherCode: parsed.weatherCode,
      observedAt: parsed.observedAt,
      fetchedAt: receivedAt.toISOString(),
    },
  };
}
