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
  /** Raw app settings (process.env in production). Resolved and validated by the core. */
  settings: Readonly<Record<string, string | undefined>>;
  log: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

/** The weather fields we use from one successful upstream response (spec 001 R12). */
export interface CurrentWeather {
  tempC: number;
  windKph: number;
  weatherCode: number;
  observedAt: string;
}

/** Result of ONE upstream attempt. Always returned, never thrown (plan 002 §4). */
export type AttemptOutcome =
  | { kind: 'ok'; data: CurrentWeather }
  | { kind: 'timeout'; timeoutMs: number }
  | { kind: 'network'; detail: string }
  | { kind: 'status'; status: number; detail: string }
  | { kind: 'bad-response'; detail: string };
