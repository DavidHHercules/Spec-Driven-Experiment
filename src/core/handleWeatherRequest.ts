import { errorBody } from './errors';
import { buildForecastUrl, parseCurrent } from './openMeteo';
import type { CoreResponse, Deps } from './types';
import { validateQuery } from './validate';
import { describeWeatherCode } from './weatherCodes';

/** Max characters of an upstream body copied into a log line. */
const LOG_SNIPPET_LENGTH = 500;

// Generic, client-safe messages. Details go to the log only (R18).
const UPSTREAM_ERROR = (): CoreResponse => ({
  status: 502,
  body: errorBody('UPSTREAM_ERROR', 'The weather provider is unavailable.'),
});
const UPSTREAM_BAD_RESPONSE = (): CoreResponse => ({
  status: 502,
  body: errorBody('UPSTREAM_BAD_RESPONSE', 'The weather provider returned an unexpected response.'),
});

/**
 * Core of the weather endpoint (spec 001). Knows nothing about Azure (N2);
 * everything non-deterministic comes in through `deps` (N1).
 */
export async function handleWeatherRequest(q: URLSearchParams, deps: Deps): Promise<CoreResponse> {
  // R2–R8: validate before anything else; R9: upstream is never called on invalid input.
  const input = validateQuery(q);
  if (!input.ok) {
    return { status: 400, body: errorBody(input.code, input.message) };
  }

  const { lat, lon } = input;
  const url = buildForecastUrl(deps.baseUrl, lat, lon);

  // R10, R16: a rejected fetch is a network-level failure.
  const startedAt = deps.now();
  let res: Response;
  try {
    res = await deps.fetch(url);
  } catch (err) {
    deps.log.error(`weather upstream network error lat=${lat} lon=${lon}: ${describeError(err)}`);
    return UPSTREAM_ERROR();
  }
  const receivedAt = deps.now();

  // Read the body as text once, so it can be both parsed and logged.
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    deps.log.error(`weather upstream body read failed status=${res.status}: ${describeError(err)}`);
    return UPSTREAM_ERROR();
  }

  // R15: non-2xx.
  if (!res.ok) {
    deps.log.error(`weather upstream status=${res.status} body=${snippet(text)}`);
    return UPSTREAM_ERROR();
  }

  // R17: invalid JSON.
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    deps.log.error(`weather upstream invalid JSON body=${snippet(text)}`);
    return UPSTREAM_BAD_RESPONSE();
  }

  // R17: wrong shape.
  const parsed = parseCurrent(json);
  if (!parsed.ok) {
    deps.log.error(`weather upstream bad response: ${parsed.reason}`);
    return UPSTREAM_BAD_RESPONSE();
  }

  // N3
  deps.log.info(
    `weather ok lat=${lat} lon=${lon} upstreamMs=${receivedAt.getTime() - startedAt.getTime()}`,
  );

  // R1, R12, R13
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

function describeError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

function snippet(text: string): string {
  return JSON.stringify(text.slice(0, LOG_SNIPPET_LENGTH));
}
