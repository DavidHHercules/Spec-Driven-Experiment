# Plan 001: Current Weather Endpoint

- **Implements:** [Spec 001](001-current-weather.md) (Approved)
- **Status:** Approved
- **Created:** 2026-11-07

The spec says **what**. This plan says **how**: stack, structure, data shapes, and how
each rule will be tested. If anything here contradicts the spec, the spec wins — and
we fix the plan (or raise a spec change, see §9).

## 1. Stack

| Concern            | Choice | Why |
|--------------------|--------|-----|
| Runtime            | Node.js 20 | Installed locally; supported by Azure Functions v4. |
| Language           | TypeScript 5, `strict: true` | Catches shape mismatches (e.g. upstream JSON) at compile time. |
| Functions model    | Azure Functions **Node.js v4 programming model** (`@azure/functions` v4) | Current model: functions registered in code with `app.http(...)`, no `function.json` files. |
| HTTP client        | Built-in `fetch` (Node 20) | No dependency needed. |
| Test runner        | Vitest | Runs TypeScript directly, fast, Jest-like API. |
| Local host         | Azure Functions Core Tools v4 (`func start`) | Required for acceptance criteria in spec §7. |

No other runtime dependencies.

## 2. Architecture

The key idea: **the Azure Function is a thin adapter.** All behavior from the spec lives in
plain TypeScript modules that know nothing about Azure (satisfies **N2**). Anything
non-deterministic — network, clock, config, logging — is passed in as a dependency
(satisfies **N1**, and makes `fetchedAt` / durations testable).

```
HTTP request
    │
    ▼
src/functions/weather.ts        ← Azure adapter (thin): reads env, wires real deps,
    │                              converts result → HttpResponseInit
    ▼
src/core/handleWeatherRequest.ts ← orchestration: validate → fetch → map → result
    │            │            │
    ▼            ▼            ▼
validate.ts  openMeteo.ts  weatherCodes.ts
```

### Why dependency injection instead of mocking globals?
We could `vi.stubGlobal('fetch', ...)` in every test, but passing `fetch` in as a parameter
makes each dependency visible in the function signature, keeps tests independent of each
other, and is the same pattern you'd use for real API clients with auth tokens later.

## 3. File layout

```
.
├── host.json                     # Functions host config
├── local.settings.example.json   # Template for local settings (committed)
├── local.settings.json           # Real local settings (git-ignored)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .funcignore                   # Files excluded from deployment package
├── .gitignore
├── src/
│   ├── functions/
│   │   └── weather.ts            # app.http('weather', ...) registration + adapter
│   └── core/
│       ├── types.ts              # Shared types (see §4)
│       ├── errors.ts             # Error codes + error body builder
│       ├── validate.ts           # parseCoordinate, validateQuery
│       ├── weatherCodes.ts       # WMO code → condition text
│       ├── openMeteo.ts          # URL building, fetch, response parsing
│       └── handleWeatherRequest.ts
└── test/
    ├── validate.test.ts
    ├── weatherCodes.test.ts
    ├── openMeteo.test.ts
    ├── handleWeatherRequest.test.ts
    └── helpers/fakes.ts          # fakeFetch, fakeClock, fakeLogger
```

## 4. Key types and signatures

```ts
// types.ts
export type ErrorCode =
  | 'MISSING_LAT' | 'MISSING_LON' | 'INVALID_LAT' | 'INVALID_LON'
  | 'UPSTREAM_ERROR' | 'UPSTREAM_BAD_RESPONSE';

export interface WeatherSummary {           // spec §3 success body
  location: { lat: number; lon: number };
  tempC: number;
  windKph: number;
  condition: string;
  weatherCode: number;
  observedAt: string;
  fetchedAt: string;
}

export interface ErrorBody { error: { code: ErrorCode; message: string } }

// What the core returns; the adapter turns this into an HTTP response.
export interface CoreResponse { status: 200 | 400 | 502; body: WeatherSummary | ErrorBody }

export interface Deps {
  fetch: typeof globalThis.fetch;
  now: () => Date;
  baseUrl: string;
  log: { info(msg: string): void; error(msg: string): void };
}
```

```ts
// validate.ts
export function parseCoordinate(raw: string): number | null;            // §4.1 format only
export function validateQuery(q: URLSearchParams):
  | { ok: true; lat: number; lon: number }
  | { ok: false; code: ErrorCode; message: string };                     // R2–R8, R19

// weatherCodes.ts
export function describeWeatherCode(code: number): string;              // R13, R14, §5

// openMeteo.ts
export function resolveBaseUrl(raw: string | undefined): string;      // R11: default + trailing slash
export function buildForecastUrl(baseUrl: string, lat: number, lon: number): string;  // R10, R11
export function parseCurrent(json: unknown):                             // R12, R17
  | { ok: true; tempC: number; windKph: number; weatherCode: number; observedAt: string }
  | { ok: false; reason: string };

// handleWeatherRequest.ts
export async function handleWeatherRequest(q: URLSearchParams, deps: Deps): Promise<CoreResponse>;
```

**Expected failures are return values, not exceptions.** Validation errors and upstream
errors are normal outcomes defined by the spec, so they're modeled as `{ ok: false }`
results. Exceptions are reserved for genuine bugs. `handleWeatherRequest` catches the one
exception we expect — `fetch` rejecting on network failure — and converts it (R16).

## 5. Implementation notes per area

### Validation (`validate.ts`)
- Format check: `raw.trim()` then regex `/^-?\d+(\.\d+)?$/`, then `Number(...)`. Never call
  `Number()` on unvalidated input (spec D2).
- "Missing" = `q.has('lat') === false`. "Present but empty" (`?lat=`) = invalid (R4).
- Check order: lat missing → lat invalid/out of range → lon missing → lon invalid/out of range (R8).
- Only `lat` and `lon` are read; nothing else is inspected (R19).
- Values are read with `q.get(...)`, which returns the first occurrence (R21).

### Open-Meteo client (`openMeteo.ts`)
- URL: `{baseUrl}/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,wind_speed_10m,weather_code`
  built with `URL` / `URLSearchParams` (never string concatenation of user input).
- Open-Meteo's defaults are already °C and km/h, so no unit params are sent.
- Expected upstream shape (only the parts we use):
  ```json
  { "current": { "time": "2026-11-07T21:00", "temperature_2m": 12.4,
                 "wind_speed_10m": 14.2, "weather_code": 61 } }
  ```
- `parseCurrent` type-checks each field per R17: `Number.isFinite` for the two numbers,
  `Number.isInteger` for the code, non-empty string for time. Extra fields are ignored.

### Orchestration (`handleWeatherRequest.ts`)
1. `validateQuery` → on failure return 400, **without touching `deps.fetch`** (R9).
2. Record start time; `await deps.fetch(url)` inside try/catch → catch = 502 `UPSTREAM_ERROR` (R16).
3. `!res.ok` → 502 `UPSTREAM_ERROR` (R15).
4. `await res.json()` inside try/catch → failure = 502 `UPSTREAM_BAD_RESPONSE` (R17).
5. `parseCurrent` → failure = 502 `UPSTREAM_BAD_RESPONSE` (R17).
6. `fetchedAt = deps.now().toISOString()` taken once the response arrives.
7. Build `WeatherSummary`; log success line with lat, lon, duration ms (N3).
8. Every upstream failure path logs details via `deps.log.error`; response body only
   contains code + generic message (R18).

### Azure adapter (`functions/weather.ts`)
```ts
app.http('weather', {
  methods: ['GET'],          // R20
  authLevel: 'anonymous',    // spec §2: no auth for now
  route: 'weather',          // → /api/weather
  handler: async (request, context) => {
    const result = await handleWeatherRequest(request.query, {
      fetch: globalThis.fetch,
      now: () => new Date(),
      baseUrl: resolveBaseUrl(process.env.OPEN_METEO_BASE_URL),  // R11: empty → default, strip trailing '/'
      log: { info: (m) => context.log(m), error: (m) => context.error(m) },
    });
    return { status: result.status, jsonBody: result.body };  // jsonBody sets Content-Type
  },
});
```
`request.query` is already a `URLSearchParams` in the v4 model, so it passes straight through.

## 6. Configuration

| Setting | Where | Value locally | Notes |
|---------|-------|---------------|-------|
| `FUNCTIONS_WORKER_RUNTIME` | `local.settings.json` | `node` | Required by the host. |
| `AzureWebJobsStorage` | `local.settings.json` | `""` | Not needed for HTTP triggers. Spec 003 (timer) will need Azurite. |
| `OPEN_METEO_BASE_URL` | `local.settings.json` | *(omit)* | R11 default applies. |

`local.settings.json` is git-ignored because in real projects it holds secrets. We commit
`local.settings.example.json` so a fresh clone knows what to create.

`package.json` essentials:
```json
{
  "main": "dist/src/functions/*.js",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "prestart": "npm run build",
    "start": "func start"
  }
}
```
`main` is how the v4 host discovers functions — a glob over compiled output.

## 7. Test strategy

| Layer | What | How |
|-------|------|-----|
| Unit — `validate` | §4.1 table, ranges, missing vs invalid, ordering | Table-driven `it.each` straight from the spec tables |
| Unit — `weatherCodes` | Every row of §5 + unknown integer | Table-driven |
| Unit — `openMeteo` | URL shape, base URL, `parseCurrent` valid/invalid shapes | Pure functions, no fakes needed |
| Unit — `handleWeatherRequest` | End-to-end core behavior, status codes, logging, no-fetch-on-invalid | `fakeFetch` records calls and returns scripted responses or throws; `fakeClock` returns fixed dates; `fakeLogger` captures lines |
| Manual smoke | Spec §7 acceptance criteria | `npm start`, then hit `/api/weather` with a browser or `curl` |

Test names start with the rule ID, e.g. `it('R9: does not call upstream when lat is invalid', ...)`,
so `vitest run -t R9` runs exactly the tests for one rule.

## 8. Traceability

| Rule | Module | Test file |
|------|--------|-----------|
| R1 | handleWeatherRequest | handleWeatherRequest.test |
| R2–R8, §4.1 | validate | validate.test |
| R9 | handleWeatherRequest | handleWeatherRequest.test |
| R10, R11 | openMeteo, adapter | openMeteo.test |
| R12 | openMeteo, handleWeatherRequest | openMeteo.test, handleWeatherRequest.test |
| R13, R14, §5 | weatherCodes | weatherCodes.test |
| R15, R16, R18 | handleWeatherRequest | handleWeatherRequest.test |
| R17 | openMeteo, handleWeatherRequest | openMeteo.test, handleWeatherRequest.test |
| R19, R21 | validate | validate.test |
| R20 | adapter (`methods: ['GET']`) | *not tested, by design* |
| N1 | all tests | enforced by DI — no test uses real `fetch` |
| N2 | core/* | core has no `@azure/functions` import |
| N3 | handleWeatherRequest | handleWeatherRequest.test |

## 9. Spec feedback (gaps found while planning)

Planning surfaced questions the spec doesn't answer. Per our workflow, these go back to
the spec rather than being silently decided in code.

| # | Gap | Proposed answer | Spec change |
|---|-----|-----------------|-------------|
| F1 | Duplicate params: `?lat=1&lat=50` — which wins? | Use the **first** value (what `URLSearchParams.get` does). Simple and conventional. | New rule R21 + decision D6 |
| F2 | `OPEN_METEO_BASE_URL` set to empty string — "unset"? | Treat empty as unset → default. An empty URL is never valid. | Clarify R11 |
| F3 | `OPEN_METEO_BASE_URL` with trailing slash (`https://x.com/`) | Tolerate it — must not produce `//v1/forecast`. | Clarify R11 |

**Resolved 2026-11-07:** all three accepted as proposed. Spec amended — F1 → R21 / D6,
F2 + F3 → R11 / D7.

## 10. Risks

- **Open-Meteo changes its response shape.** Mitigated by R17 strict parsing — we fail
  loudly with `UPSTREAM_BAD_RESPONSE` rather than returning garbage.
- **Core Tools not installed** (current state). Needed only for the manual smoke test;
  all unit tests run with plain `npm test`.
- **No timeout on upstream calls.** A hung Open-Meteo request hangs our function until
  the host timeout. Known and accepted — Spec 002 addresses it.
