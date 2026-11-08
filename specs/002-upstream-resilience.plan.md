# Plan 002: Upstream Resilience — Timeouts & Retries

- **Implements:** [Spec 002](002-upstream-resilience.md) (Approved)
- **Builds on:** [Plan 001](001-current-weather.plan.md) — same stack, same layering
- **Status:** Approved
- **Created:** 2026-11-08

## 1. What changes, at a glance

```
                          BEFORE (Spec 001)                     AFTER (Spec 002)
handleWeatherRequest   validate → fetch → text → parse     validate → config → runWithRetries → map outcome
                       (all inline)                                           │
                                                                              ▼
                                                              fetchAttemptOnce  (one attempt, with timeout)
                                                                 fetch → text → parse → AttemptOutcome
```

The inline fetch/parse code in `handleWeatherRequest` moves into a **single-attempt**
function that never throws and always returns a classified outcome. A small **retry loop**
calls it repeatedly. `handleWeatherRequest` only maps the final outcome to an HTTP response.

No new runtime dependencies.

## 2. Key design choice: how to test time

Spec 002 needs timeouts (R22) and backoff waits (R27), and N4 forbids tests that really wait.

| Option | How | Verdict |
|--------|-----|---------|
| A. Inject `sleep()` and a timeout helper via `Deps` | Tests pass fakes that resolve on command | ✗ Timeouts are a *race* between fetch and a timer. Coordinating two fake promises by hand is fragile and hard to read. |
| B. **Vitest fake timers** | Production code uses plain `setTimeout`; tests call `vi.useFakeTimers()` and `await vi.advanceTimersByTimeAsync(ms)` | ✓ Purpose-built for exactly this. Tests read like a timeline: "advance 249 ms → 1 call; advance 1 ms → 2 calls". |

**Choice: B.** This departs from Plan 001's "inject everything" rule, deliberately: dependency
injection is a tool for control, and for timers the test framework already gives full
control. `fetch` and `now` stay injected as before.

## 3. Modules

```
src/core/
├── types.ts                 # + UPSTREAM_TIMEOUT, status 504, AttemptOutcome, log.warn, Deps.settings
├── config.ts                # NEW  resolveResilienceConfig (R32, R33)
├── fetchAttempt.ts          # NEW  fetchAttemptOnce — one attempt with timeout + abort (R22, N6)
├── retry.ts                 # NEW  runWithRetries — loop, classify, backoff (R25–R28, R30)
├── handleWeatherRequest.ts  # CHANGED  orchestration + outcome → response mapping (R24, R29, R31)
├── openMeteo.ts             # unchanged
├── validate.ts              # unchanged
└── weatherCodes.ts          # unchanged
src/functions/weather.ts     # CHANGED  passes process.env as settings; maps log.warn
scripts/never-respond-server.js  # NEW  dev tool for the 504 acceptance check
```

## 4. Types

```ts
// types.ts — additions / changes
export type ErrorCode = ... | 'UPSTREAM_TIMEOUT';

export interface CoreResponse { status: 200 | 400 | 502 | 504; body: WeatherSummary | ErrorBody }

/** Result of ONE upstream attempt. Never thrown — always returned. */
export type AttemptOutcome =
  | { kind: 'ok'; data: CurrentWeather }               // CurrentWeather = parseCurrent's ok shape
  | { kind: 'timeout'; timeoutMs: number }
  | { kind: 'network'; detail: string }
  | { kind: 'status'; status: number; detail: string }  // detail = body snippet
  | { kind: 'bad-response'; detail: string };

export interface Deps {
  fetch: typeof globalThis.fetch;
  now: () => Date;
  settings: Readonly<Record<string, string | undefined>>;  // CHANGED: replaces baseUrl
  log: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };  // + warn
}
```

**Why `settings` replaces `baseUrl`:** with three settings now (`OPEN_METEO_BASE_URL`,
`UPSTREAM_TIMEOUT_MS`, `UPSTREAM_MAX_ATTEMPTS`), resolving them in the adapter would put
logic (defaults, validation, warnings) in the Azure layer. Passing raw settings keeps the
adapter boring and makes R33's warning testable in the core (N2).

## 5. Module details

### `config.ts` — R32, R33
```ts
export interface ResilienceConfig { timeoutMs: number; maxAttempts: number }
export function resolveResilienceConfig(settings): { config: ResilienceConfig; warnings: string[] };
```
- Unset or empty (after trim) → default, no warning.
- Otherwise: trim, must match `/^\d+$/`, then range check. Fail → default + warning
  `UPSTREAM_TIMEOUT_MS="abc" is invalid (expected integer 100–5000); using default 2000`.
- Pure function; `handleWeatherRequest` logs the warnings via `deps.log.warn`.

### `fetchAttempt.ts` — R22, N6
```ts
export async function fetchAttemptOnce(fetchFn, url, timeoutMs): Promise<AttemptOutcome>;
```
1. `const controller = new AbortController()`; `setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs)`.
2. `fetch(url, { signal: controller.signal })` → then `res.text()`. Both are covered by the
   same signal, so the timeout includes the body read (spec §3 "Attempt").
3. Any rejection: `timedOut ? {kind:'timeout'} : {kind:'network', detail}`.
4. `!res.ok` → `status`; `JSON.parse` failure or `parseCurrent` failure → `bad-response`.
5. `finally { clearTimeout(timer) }` — no stray timers after a fast success.

Uses our own `AbortController` + `setTimeout` rather than `AbortSignal.timeout()`, because
the latter uses internal timers that Vitest's fake timers can't control.

### `retry.ts` — R25–R28, R30
```ts
export const BACKOFF_MS = [250, 500, 1000] as const;  // before attempts 2, 3, 4 (R27)
export function isTransient(o: AttemptOutcome): boolean;  // R25 / R26
export async function runWithRetries(
  attempt: () => Promise<AttemptOutcome>,
  maxAttempts: number,
  log: (msg: string) => void,
): Promise<{ outcome: AttemptOutcome; attempts: number }>;
```
- Loop: run attempt → `ok` or permanent → return. Transient and attempts left → log
  "retrying in N ms", `await delay(BACKOFF_MS[n-1])`, continue. Otherwise log "giving up", return.
- Returns the **last** outcome (R29 / D13).
- Knows nothing about weather — `AttemptOutcome` is its only coupling.

### `handleWeatherRequest.ts` — R24, R29, R31, R33
1. `validateQuery` (unchanged).
2. `resolveResilienceConfig(deps.settings)` → log each warning (R33).
3. `resolveBaseUrl(deps.settings.OPEN_METEO_BASE_URL)` → `buildForecastUrl`.
4. `start = deps.now()`; `runWithRetries(() => fetchAttemptOnce(deps.fetch, url, timeoutMs), maxAttempts, deps.log.error)`.
5. Map final outcome:

   | Outcome | Response |
   |---------|----------|
   | `ok` | 200, Spec 001 body; info log with `attempts=N upstreamMs=…` (R31) |
   | `timeout` | 504 `UPSTREAM_TIMEOUT` (R24) |
   | `network`, `status` | 502 `UPSTREAM_ERROR` |
   | `bad-response` | 502 `UPSTREAM_BAD_RESPONSE` |

### Adapter
`settings: process.env`, `log.warn: (m) => context.warn(m)`. Still no branching.

## 6. Test strategy

| File | Covers | Technique |
|------|--------|-----------|
| `config.test.ts` (new) | R32, R33 | Table-driven: unset, empty, valid, boundaries (100, 5000, 1, 4), invalid (`abc`, `0`, `2.5`, `9999`, `-5`, ` 3 `) |
| `fetchAttempt.test.ts` (new) | R22, N6, outcome classification | Fake timers; fake fetch that **hangs until its signal aborts** and records that the abort happened (N6); a variant whose **body** hangs (R22 covers body read) |
| `retry.test.ts` (new) | R25–R28, R29 (last wins), R30 | Scripted outcomes (no fetch at all); fake timers to assert backoff timing exactly: at 249 ms one attempt, at 250 ms two |
| `handleWeatherRequest.test.ts` (extended) | R24, R29 mapping, R31, R33, end-to-end retry | Existing fakes + fake timers where needed |

### Keeping Spec 001 tests meaningful
Spec 001 tests assume a single attempt (e.g. "upstream 500 → 502" with one scripted
response). With retries on, they would make extra calls. So `makeDeps` defaults to
`UPSTREAM_MAX_ATTEMPTS: '1'` — **those tests keep testing exactly what they always did**,
and Spec 002 tests opt into retries explicitly. Tests that change because of the
`baseUrl → settings` refactor are updated mechanically and listed in the commit message.

### Fake fetch upgrades (`helpers/fakes.ts`)
- New step `{ hang: true }` → returns a promise that only settles (rejects with `AbortError`) when the request's `signal` aborts; records `aborted: true` on the call.
- New step `{ status, hangBody: true }` → resolves headers, but the body stream never ends until aborted.
- Calls recorded as `{ url, aborted }` instead of just `url`.

## 7. Traceability

| Rule | Module | Test file |
|------|--------|-----------|
| R22 | fetchAttempt | fetchAttempt.test |
| R23 | (derived: config ranges + BACKOFF_MS) | config.test (ranges), retry.test (backoff constants) |
| R24 | handleWeatherRequest | handleWeatherRequest.test |
| R25, R26 | retry (`isTransient`) | retry.test |
| R27 | retry | retry.test |
| R28 | retry | retry.test, handleWeatherRequest.test |
| R29 | retry (last wins) + handleWeatherRequest (mapping) | both |
| R30 | retry | retry.test |
| R31 | handleWeatherRequest | handleWeatherRequest.test |
| R32, R33 | config + handleWeatherRequest (logging) | config.test, handleWeatherRequest.test |
| N4 | all | suite duration check in T-acceptance |
| N5 | config ranges | config.test (boundary values) |
| N6 | fetchAttempt | fetchAttempt.test (`aborted: true`) |

## 8. Spec feedback (gaps found while planning)

| # | Gap | Resolution |
|---|-----|------------|
| F4 | Connection drops **mid-body** on a 2xx: is that "network" (retried) or "bad response" (not)? | **Network** — the data never fully arrived; nothing is known to be wrong with it. Spec clarified in R25. |
| F5 | Settings with surrounding whitespace (`" 3 "`): valid or invalid? | **Valid after trimming**, consistent with D2 for query params. Spec clarified in R33. |

Both resolved by Claude under the same delegation as D8–D14 and recorded in the Spec 002 changelog.

## 9. Risks

- **Fake timers + async code can deadlock tests** if a promise awaits a timer that's never
  advanced. Mitigation: always use `advanceTimersByTimeAsync` (the async variant), and set a
  per-test timeout so a stuck test fails fast instead of hanging.
- **Undici (Node's fetch) abort behavior on body reads.** Expected: aborting the signal also
  rejects `res.text()`. Verified for real in the local acceptance check, not just with fakes.
- **Refactor risk** in moving fetch/parse out of `handleWeatherRequest`. Mitigation: do it
  first as a pure refactor (no behavior change) with all 133 existing tests green, *then*
  add retries.
