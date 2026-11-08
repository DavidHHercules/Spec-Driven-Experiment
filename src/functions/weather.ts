import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { handleWeatherRequest } from '../core/handleWeatherRequest';

/**
 * Azure adapter for the weather endpoint. Deliberately boring: wires real dependencies into
 * the core and converts its result to an HTTP response. All behavior lives in src/core.
 */
export async function weather(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const result = await handleWeatherRequest(request.query, {
    fetch: globalThis.fetch,
    now: () => new Date(),
    settings: process.env, // app settings; resolved and validated in the core
    log: {
      info: (msg) => context.log(msg),
      warn: (msg) => context.warn(msg),
      error: (msg) => context.error(msg),
    },
  });

  // jsonBody serializes the body and sets Content-Type: application/json (spec 001 §3).
  return { status: result.status, jsonBody: result.body };
}

app.http('weather', {
  methods: ['GET'], // R20
  authLevel: 'anonymous', // spec 001 §2: no auth for now
  route: 'weather', // → /api/weather
  handler: weather,
});
