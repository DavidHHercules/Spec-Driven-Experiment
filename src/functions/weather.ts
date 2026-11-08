import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { handleWeatherRequest } from '../core/handleWeatherRequest';
import { resolveBaseUrl } from '../core/openMeteo';

/**
 * Azure adapter for spec 001. Deliberately boring: wires real dependencies into the
 * core and converts its result to an HTTP response. All behavior lives in src/core.
 */
export async function weather(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const result = await handleWeatherRequest(request.query, {
    fetch: globalThis.fetch,
    now: () => new Date(),
    baseUrl: resolveBaseUrl(process.env.OPEN_METEO_BASE_URL), // R11
    log: {
      info: (msg) => context.log(msg),
      error: (msg) => context.error(msg),
    },
  });

  // jsonBody serializes the body and sets Content-Type: application/json (spec §3).
  return { status: result.status, jsonBody: result.body };
}

app.http('weather', {
  methods: ['GET'], // R20
  authLevel: 'anonymous', // spec §2: no auth for now
  route: 'weather', // → /api/weather
  handler: weather,
});
