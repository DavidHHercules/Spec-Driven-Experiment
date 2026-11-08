import { resolveResilienceConfig } from './config';
import { errorBody } from './errors';
import { getCurrentWeather } from './getCurrentWeather';
import type { AttemptOutcome, CoreResponse, Deps } from './types';
import { validateQuery } from './validate';
import { describeWeatherCode } from './weatherCodes';

/**
 * Core of the weather endpoint (specs 001, 002). Knows nothing about Azure (N2);
 * everything non-deterministic comes in through `deps` (N1).
 */
export async function handleWeatherRequest(q: URLSearchParams, deps: Deps): Promise<CoreResponse> {
  // R32, R33: invalid settings fall back to defaults; warn on EVERY invocation, keep serving.
  const { config, warnings } = resolveResilienceConfig(deps.settings);
  for (const w of warnings) deps.log.warn(w);

  // R2–R8: validate the query; R9: upstream is never called on invalid input.
  const input = validateQuery(q);
  if (!input.ok) {
    return { status: 400, body: errorBody(input.code, input.message) };
  }

  const { lat, lon } = input;

  // R10–R30 via the shared client. Each failed attempt is logged with its detail (R18, R30);
  // the response only ever carries a generic message.
  const { outcome, attempts, startedAt, finishedAt } = await getCurrentWeather(
    lat,
    lon,
    config,
    deps,
    `weather upstream lat=${lat} lon=${lon}`,
  );

  if (outcome.kind !== 'ok') {
    return failureResponse(outcome); // R29: last attempt decides
  }

  // N3 + R31: upstreamMs spans all attempts and backoffs.
  deps.log.info(
    `weather ok lat=${lat} lon=${lon} attempts=${attempts} upstreamMs=${finishedAt.getTime() - startedAt.getTime()}`,
  );

  // R1, R12, R13
  const data = outcome.data;
  return {
    status: 200,
    body: {
      location: { lat, lon },
      tempC: data.tempC,
      windKph: data.windKph,
      condition: describeWeatherCode(data.weatherCode),
      weatherCode: data.weatherCode,
      observedAt: data.observedAt,
      fetchedAt: finishedAt.toISOString(),
    },
  };
}

/** Final outcome → client-safe response. Details stay in the logs (R18). */
function failureResponse(outcome: Exclude<AttemptOutcome, { kind: 'ok' }>): CoreResponse {
  switch (outcome.kind) {
    case 'timeout': // R24
      return { status: 504, body: errorBody('UPSTREAM_TIMEOUT', 'The weather provider did not respond in time.') };
    case 'network': // R16
    case 'status': // R15
      return { status: 502, body: errorBody('UPSTREAM_ERROR', 'The weather provider is unavailable.') };
    case 'bad-response': // R17
      return {
        status: 502,
        body: errorBody('UPSTREAM_BAD_RESPONSE', 'The weather provider returned an unexpected response.'),
      };
  }
}
