☑ |☑ |☑ |☑ |# Tasks 001: Current Weather Endpoint

- **Implements:** [Spec 001](001-current-weather.md) via [Plan 001](001-current-weather.plan.md)
- **Created:** 2026-11-07

## How to work through this list

- Do tasks **in order**; each builds on the previous ones.
- Each task is small enough to finish and commit on its own. **One task = one commit**,
  with the task ID in the message (e.g. `T4: validateQuery (R2–R8, R19, R21)`).
- For tasks that implement rules: **write the tests first**, watch them fail, then write
  the code. A test that never failed hasn't proven anything.
- A task is done only when its **Done when** list is fully true. Tick the box then.
- If a task reveals a spec gap, **stop** and raise it — don't decide it in code.

## Progress

| Task | Title | Rules | Status |
|------|-------|-------|--------|
| T1  | Project scaffolding | — | ☑ |
| T2  | Shared types and error builder | §3 | ☑ |
| T3  | `parseCoordinate` | §4.1, D2 | ☑ |
| T4  | `validateQuery` | R2–R8, R19, R21 | ☐ |
| T5  | Weather code mapping | R13, R14, §5 | ☐ |
| T6  | Base URL and request URL | R10, R11 | ☐ |
| T7  | Upstream response parsing | R12, R17 | ☐ |
| T8  | Test fakes | N1 | ☐ |
| T9  | Orchestration — success path | R1, R10, R12, N3 | ☐ |
| T10 | Orchestration — failure paths | R9, R15–R18 | ☐ |
| T11 | Azure Function adapter | R11, R20, N2 | ☐ |
| T12 | Local smoke test | §7 | ☐ |
| T13 | Acceptance review | §7 | ☐ |

---

## T1 — Project scaffolding

Create the files from plan §3 that aren't code: `package.json`, `tsconfig.json`,
`vitest.config.ts`, `host.json`, `local.settings.example.json`, `.gitignore`, `.funcignore`.
Install `@azure/functions` (dependency) and `typescript`, `vitest`, `@types/node` (dev).

**Done when**
- [x] `npm install` succeeds.
- [x] `npm test` succeeds with zero tests (`passWithNoTests`).
- [x] `node_modules/`, `dist/`, `local.settings.json` are git-ignored.

> *Correction:* originally also required `npm run build` to succeed, but `tsc` errors when
> there are no source files (TS18003). Build check moved to T2.

## T2 — Shared types and error builder

`src/core/types.ts` and `src/core/errors.ts` per plan §4. `errors.ts` exports a
`errorBody(code, message)` helper that produces the spec §3 error shape.

**Done when**
- [x] `npm run build` and `npm run typecheck` succeed (types compile under `strict`).
- [x] One test confirms `errorBody` output matches spec §3 exactly.

## T3 — `parseCoordinate`

`src/core/validate.ts` → `parseCoordinate(raw): number | null`. Only the format check from
§4.1; **no range check** here (that's T4).

**Tests first** — `test/validate.test.ts`:
- [x] One `it.each` case per row of spec §4.1 (15 rows), using the table's exact inputs and outputs.

**Done when**
- [x] All §4.1 rows pass.
- [x] `Number()` is only called after the regex check (D2).

## T4 — `validateQuery`

`validateQuery(q: URLSearchParams)` per plan §5.

**Tests first** — name each test with its rule ID:
- [x] R2: no `lat` → `MISSING_LAT`
- [x] R3: no `lon` → `MISSING_LON`
- [x] R4: `lat=abc`, `lat=` → `INVALID_LAT`
- [x] R5: `lon=abc`, `lon=` → `INVALID_LON`
- [x] R6: `lat=90.0001`, `lat=-91` → `INVALID_LAT`; `lat=90`, `lat=-90` → ok
- [x] R7: `lon=180.5`, `lon=-181` → `INVALID_LON`; `lon=180`, `lon=-180` → ok
- [x] R8: both missing → `MISSING_LAT`; `lat=abc&lon=abc` → `INVALID_LAT`; `lat=1` + no lon → `MISSING_LON`
- [x] R19: `lat=1&lon=2&foo=bar` → ok, same result as without `foo`
- [x] R21: `lat=1&lat=50&lon=2` → lat is 1; `lat=1&lat=abc&lon=2` → ok

**Done when**
- [x] All tests above pass.

## T5 — Weather code mapping

`src/core/weatherCodes.ts` → `describeWeatherCode(code)`.

**Tests first** — `test/weatherCodes.test.ts`:
- [x] Every code listed in spec §5 maps to its text (table-driven).
- [x] R14: unlisted integers (e.g. `4`, `100`, `-1`) → `"Unknown"`.

**Done when**
- [x] All tests pass.

## T6 — Base URL and request URL

`src/core/openMeteo.ts` → `resolveBaseUrl`, `buildForecastUrl`.

**Tests first** — `test/openMeteo.test.ts`:
- [x] R11: `undefined` → default; `""` → default; `"https://x.com/"` and `"https://x.com"` → same URL.
- [x] R10: URL path is `/v1/forecast`; query has `latitude`, `longitude`, and
      `current=temperature_2m,wind_speed_10m,weather_code`.
- [x] R10 / D4: `lat=47.123456789` appears unrounded in the URL.

**Done when**
- [x] All tests pass.
- [x] URL built with `URL` / `URLSearchParams`, not string concatenation of inputs.

## T7 — Upstream response parsing

`parseCurrent(json: unknown)` in `openMeteo.ts`.

**Tests first**:
- [x] R12: valid sample body → fields returned unchanged (include a value like `12.37` to prove no rounding).
- [x] R17: each required field **missing** → not ok (4 cases).
- [x] R17: each required field **null** → not ok (4 cases).
- [x] R17: wrong types — `temperature_2m: "12"`, `wind_speed_10m: true`, `weather_code: 61.5`,
      `weather_code: "rain"`, `time: ""` → not ok.
- [x] R17: `current` missing entirely; body is `null`; body is an array → not ok.
- [x] Extra unknown fields in `current` → still ok.

**Done when**
- [x] All tests pass.

## T8 — Test fakes

`test/helpers/fakes.ts`:
- `fakeFetch(...)` — records each call's URL; scripted to return a status + body, return
  invalid JSON, or throw (network error).
- `fakeClock(...dates)` — `now()` returns given dates in sequence.
- `fakeLogger()` — captures `info` / `error` lines in arrays.

**Done when**
- [ ] Fakes compile and are used by T9/T10. (No separate tests — they're exercised there.)

## T9 — Orchestration: success path

`src/core/handleWeatherRequest.ts`, happy path only.

**Tests first** — `test/handleWeatherRequest.test.ts`:
- [ ] R1: valid query + good upstream → status 200, body matches spec §3 shape exactly (all 7 fields).
- [ ] R10: fake fetch called exactly once with the expected URL.
- [ ] R12/R13: body fields come from upstream; `condition` matches the code.
- [ ] `fetchedAt` equals the fake clock's time after the response, in ISO 8601 UTC.
- [ ] `location` echoes parsed numbers (e.g. `" 47.6 "` → `47.6`).
- [ ] N3: exactly one `info` line containing lat, lon, and a duration in ms.

**Done when**
- [ ] All tests pass.

## T10 — Orchestration: failure paths

**Tests first**:
- [ ] R9: invalid query → 400, fake fetch called **zero** times.
- [ ] R15: upstream 500 and 404 → 502 `UPSTREAM_ERROR`.
- [ ] R16: fetch throws → 502 `UPSTREAM_ERROR`.
- [ ] R17: upstream 200 with invalid JSON → 502 `UPSTREAM_BAD_RESPONSE`.
- [ ] R17: upstream 200 with bad shape → 502 `UPSTREAM_BAD_RESPONSE`.
- [ ] R18: in each failure above, an `error` log line contains the detail (status / message),
      and the response `message` does **not** contain it.

**Done when**
- [ ] All tests pass.
- [ ] No test in the suite uses real `fetch` (N1).

## T11 — Azure Function adapter

`src/functions/weather.ts` per plan §5. Wires real `fetch`, real clock, `resolveBaseUrl(process.env...)`,
and `context.log` / `context.error`.

**Done when**
- [ ] `npm run build` produces `dist/src/functions/weather.js`.
- [ ] `methods: ['GET']`, `authLevel: 'anonymous'`, route `weather` (R20).
- [ ] N2: `grep -r "@azure/functions" src/core` returns nothing.
- [ ] Adapter contains no branching logic beyond wiring (keep it boring).

## T12 — Local smoke test

Prerequisite: `winget install Microsoft.Azure.FunctionsCoreTools`, then copy
`local.settings.example.json` → `local.settings.json`.

**Done when** (`npm start`, then request each URL)
- [ ] `/api/weather?lat=47.6&lon=-122.3` → 200 with real data and a sensible `condition`.
- [ ] `/api/weather?lat=999&lon=0` → 400 `INVALID_LAT`.
- [ ] `/api/weather?lat=47.6` → 400 `MISSING_LON`.
- [ ] With `OPEN_METEO_BASE_URL` pointed at a bad host → 502 `UPSTREAM_ERROR`, detail visible in the `func` console only.
- [ ] Console shows the N3 success log line.

## T13 — Acceptance review

**Done when**
- [ ] Every rule R1–R21 (except R20) has a test whose name starts with its ID.
      Check with `npx vitest run -t R<n>` for each.
- [ ] Every spec §7 checkbox is ticked.
- [ ] No spec gaps left unrecorded; any found during implementation are in the spec changelog.
- [ ] README spec table: 001 → **Done**.
