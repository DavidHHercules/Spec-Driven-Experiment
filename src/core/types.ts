/** Stable, machine-readable error codes (spec §3, §4). */
export type ErrorCode =
  | 'MISSING_LAT'
  | 'MISSING_LON'
  | 'INVALID_LAT'
  | 'INVALID_LON'
  | 'UPSTREAM_ERROR'
  | 'UPSTREAM_BAD_RESPONSE';

/** Success response body (spec §3). */
export interface WeatherSummary {
  location: { lat: number; lon: number };
  tempC: number;
  windKph: number;
  condition: string;
  weatherCode: number;
  observedAt: string;
  fetchedAt: string;
}

/** Error response body (spec §3). */
export interface ErrorBody {
  error: { code: ErrorCode; message: string };
}

/** What the core returns; the Azure adapter turns this into an HTTP response. */
export interface CoreResponse {
  status: 200 | 400 | 502;
  body: WeatherSummary | ErrorBody;
}

/** Everything non-deterministic the core needs, injected so tests can fake it (N1, N2). */
export interface Deps {
  fetch: typeof globalThis.fetch;
  now: () => Date;
  baseUrl: string;
  log: { info(msg: string): void; error(msg: string): void };
}
