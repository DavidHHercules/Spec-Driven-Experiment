# Spec 001: Current Weather Endpoint

- **Status:** Implemented
- **Author:** David Hercules
- **Created:** 2026-11-07
- **Approved:** 2026-11-07
- **Implemented:** 2026-11-08

## 1. Goal

Provide an HTTP endpoint that returns a short, human-friendly summary of the current
weather at a given latitude/longitude, using Open-Meteo as the data source.

Consumers should not need to know anything about Open-Meteo's request or response format.

## 2. Scope

### In scope
- One HTTP-triggered function: `GET /api/weather`
- Input via query string: latitude and longitude
- Calling Open-Meteo's forecast API for *current* conditions
- Mapping the response into our own response shape
- Translating weather codes into readable text
- Basic failure response when Open-Meteo cannot be reached or returns an error

### Out of scope (for now)
- Forecasts (hourly/daily)
- Looking up locations by city name
- Unit selection (Fahrenheit, mph)
- Caching, and any coordinate rounding that caching might need (see D4)
- Timeouts, retries, detailed upstream error classification → **Spec 002**
- Authentication on our endpoint (anonymous access is fine locally)
- HTTP methods other than `GET` (see D3)
- Deployment → **Spec 004**

## 3. Interface

### Request

```
GET /api/weather?lat={latitude}&lon={longitude}
```

| Param | Required | Format (see D2)  | Valid range           |
|-------|----------|------------------|-----------------------|
| `lat` | yes      | decimal number   | -90 to 90 inclusive   |
| `lon` | yes      | decimal number   | -180 to 180 inclusive |

Any other query parameters are ignored (see D1).

### Success response — `200 OK`, `Content-Type: application/json`

```json
{
  "location": { "lat": 47.6, "lon": -122.3 },
  "tempC": 12.4,
  "windKph": 14.2,
  "condition": "Light rain",
  "weatherCode": 61,
  "observedAt": "2026-11-07T21:00",
  "fetchedAt": "2026-11-07T21:14:03.512Z"
}
```

| Field         | Meaning |
|---------------|---------|
| `location`    | The coordinates as *we* received and parsed them (numbers, not rounded). |
| `tempC`       | Air temperature at 2 m, °C, as returned by Open-Meteo. |
| `windKph`     | Wind speed at 10 m, km/h, as returned by Open-Meteo. |
| `condition`   | Readable text derived from `weatherCode` (see §5). |
| `weatherCode` | Raw WMO weather code from Open-Meteo. |
| `observedAt`  | Open-Meteo's `current.time` value, passed through unchanged. |
| `fetchedAt`   | When our function received the upstream response, ISO 8601 UTC. |

### Error response shape (all errors)

```json
{ "error": { "code": "INVALID_LAT", "message": "lat must be a number between -90 and 90" } }
```

`code` is a stable machine-readable string. `message` is for humans and may change.

## 4. Behavior rules

Each rule has an ID so tests and tasks can reference it.

### Input validation

- **R1** — Given `lat` and `lon` are valid, when the endpoint is called, then it responds `200` with the success shape in §3.
- **R2** — Given `lat` is absent from the query string, then respond `400` with code `MISSING_LAT`.
- **R3** — Given `lon` is absent from the query string, then respond `400` with code `MISSING_LON`.
- **R4** — Given `lat` is present but does not match the accepted number format (§4.1), then respond `400` with code `INVALID_LAT`. This includes an empty value (`?lat=`).
- **R5** — Given `lon` is present but does not match the accepted number format (§4.1), then respond `400` with code `INVALID_LON`. This includes an empty value (`?lon=`).
- **R6** — Given `lat` is outside -90..90, then respond `400` with code `INVALID_LAT`.
- **R7** — Given `lon` is outside -180..180, then respond `400` with code `INVALID_LON`.
- **R8** — Given both parameters are invalid, then report only the **first** problem, checking `lat` before `lon`.
- **R9** — Given validation fails, then Open-Meteo is **not** called.
- **R19** — Given the query string contains parameters other than `lat` and `lon`, then they are ignored and do not affect the response. *(D1)*
- **R21** — Given `lat` or `lon` appears more than once (e.g. `?lat=1&lat=50`), then only the **first** occurrence is used; later occurrences are ignored and not validated. *(D6)*

### 4.1 Accepted number format *(D2)*

After trimming leading/trailing whitespace, the value must match: optional `-`, one or more
digits, optionally followed by `.` and one or more digits.

| Input        | Accepted? | Parsed as |
|--------------|-----------|-----------|
| `47.6`       | yes       | 47.6      |
| `-122.3`     | yes       | -122.3    |
| `0`          | yes       | 0         |
| ` 47.6 `     | yes       | 47.6      |
| `90`         | yes       | 90 (boundary) |
| `-90.0`      | yes       | -90 (boundary) |
| *(empty)*    | no        | —         |
| `abc`        | no        | —         |
| `+47.6`      | no        | —         |
| `.5`         | no        | —         |
| `5.`         | no        | —         |
| `1e1`        | no        | —         |
| `0x10`       | no        | —         |
| `47,6`       | no        | —         |
| `NaN`, `Infinity` | no   | —         |

### Upstream call

- **R10** — Given valid input, then exactly one request is made to Open-Meteo's forecast endpoint requesting current `temperature_2m`, `wind_speed_10m`, and `weather_code`, using the parsed coordinates without rounding. *(D4)*
- **R11** — The Open-Meteo base URL is read from configuration (app setting `OPEN_METEO_BASE_URL`), defaulting to `https://api.open-meteo.com` if unset **or empty**. A trailing `/` on the configured value is tolerated: `https://x.com` and `https://x.com/` produce the same request URL. *(D7)*

### Response mapping

- **R12** — `tempC`, `windKph`, `weatherCode`, `observedAt` are taken from Open-Meteo's `current` object without modification (no rounding).
- **R13** — `condition` is derived from `weatherCode` per §5.
- **R14** — Given Open-Meteo returns an integer weather code not listed in §5, then `condition` is `"Unknown"` and the response is still `200`. *(D5)*

### Upstream failure (minimal — expanded in Spec 002)

- **R15** — Given Open-Meteo responds with a non-2xx status, then respond `502` with code `UPSTREAM_ERROR`.
  ↳ *Amended by [Spec 002](002-upstream-resilience.md#6-changes-to-spec-001): 500/502/503/504 are retried before this applies.*
- **R16** — Given the request to Open-Meteo fails at the network level, then respond `502` with code `UPSTREAM_ERROR`.
  ↳ *Amended by [Spec 002](002-upstream-resilience.md#6-changes-to-spec-001): retried before this applies.*
- **R17** — Given Open-Meteo returns 2xx but the body is not valid JSON, or any field required by R12 is missing, `null`, or the wrong type, then respond `502` with code `UPSTREAM_BAD_RESPONSE`. Expected types: *(D5)*
  - `current.temperature_2m` — finite number
  - `current.wind_speed_10m` — finite number
  - `current.weather_code` — integer
  - `current.time` — non-empty string
- **R18** — Upstream failure details (status, body, error message) are logged but **not** included in our response.

### HTTP methods *(D3)*

- **R20** — Only `GET` is part of this contract. We make no promise about the status code returned for other methods (the Functions runtime decides), and tests do not cover it.

## 5. Weather code mapping (WMO)

| Code(s)     | `condition`             |
|-------------|-------------------------|
| 0           | Clear sky               |
| 1           | Mainly clear            |
| 2           | Partly cloudy           |
| 3           | Overcast                |
| 45, 48      | Fog                     |
| 51, 53, 55  | Drizzle                 |
| 56, 57      | Freezing drizzle        |
| 61          | Light rain              |
| 63          | Rain                    |
| 65          | Heavy rain              |
| 66, 67      | Freezing rain           |
| 71, 73, 75  | Snow                    |
| 77          | Snow grains             |
| 80, 81, 82  | Rain showers            |
| 85, 86      | Snow showers            |
| 95          | Thunderstorm            |
| 96, 99      | Thunderstorm with hail  |
| *any other integer* | Unknown         |

## 6. Non-functional requirements

- **N1** — Unit tests must not make real network calls.
- **N2** — The validation and mapping logic must be testable without the Azure Functions runtime.
- **N3** — Each request logs one line on success including lat, lon, and upstream duration in ms.
  ↳ *Amended by [Spec 002](002-upstream-resilience.md#6-changes-to-spec-001): also includes attempt count (R31).*

## 7. Acceptance criteria

- [x] Every rule R1–R21 has at least one automated test (R20 is intentionally untested).
- [x] Every row of the §4.1 table has a test.
- [x] `func start` runs locally and `GET /api/weather?lat=47.6&lon=-122.3` returns a real `200` response.
- [x] `GET /api/weather?lat=999&lon=0` returns `400` / `INVALID_LAT`.

## 8. Decisions

Resolved during review. Each records the question, the choice, and **why** — so the
reasoning survives even if the people who made it are gone.

### D1 — Unknown query parameters: **ignore**
- **Question:** Should `?lat=1&lon=2&foo=bar` be rejected?
- **Decision:** Ignore extra parameters. → R19
- **Why:** Clients, proxies, and tools often append parameters (cache-busters, tracking
  tags). Rejecting them makes the API brittle for no benefit. It also lets us add optional
  parameters later (e.g. `units`) without old clients' requests changing meaning.
- **Trade-off accepted:** A typo like `?latt=47` gives `MISSING_LAT` rather than
  "unknown parameter `latt`". The error code still points at the problem.

### D2 — Number format: **strict decimal, whitespace trimmed**
- **Question:** Accept `1e1`, ` 47.6 `, etc.?
- **Decision:** Accept only plain decimals (`-?digits(.digits)?`) after trimming. → §4.1, R4, R5
- **Why:** The obvious implementation, JavaScript's `Number()`, has surprising behavior:
  `Number("")` is `0` (so `?lat=` would silently mean the equator), and `Number("0x10")`
  is `16`. A spec that says "whatever `Number()` accepts" leaks an implementation detail
  and inherits its bugs. An explicit format plus an example table is unambiguous and
  directly testable. Trimming whitespace is harmless and forgives copy-paste mistakes.
- **Trade-off accepted:** Someone sending `+47.6` or `1e1` gets a 400. Unlikely for coordinates.

### D3 — HTTP methods: **GET only**
- **Question:** Support `POST` with a JSON body too?
- **Decision:** `GET` only. Behavior for other methods is explicitly *not promised*. → R20
- **Why:** The operation is a read with two small inputs — `GET` is the standard fit and is
  cacheable. Supporting two input styles doubles validation and tests for no current need.
  We state what we *don't* promise so nobody writes a client depending on a 404 vs 405.

### D4 — Coordinate precision: **no rounding**
- **Question:** Round coordinates before calling upstream?
- **Decision:** Pass parsed values through unchanged, both to Open-Meteo and in `location`. → R10
- **Why:** No current requirement needs rounding. Its main use is improving cache hit rates,
  and caching is out of scope. Adding it now means guessing at requirements. Open-Meteo
  already snaps to its own grid. Revisit in a caching spec.

### D5 — Non-numeric `weather_code` from upstream: **bad response**
- **Question:** If `weather_code` is `"rain"` or `null`, is that `"Unknown"` or an error?
- **Decision:** Error (`UPSTREAM_BAD_RESPONSE`). Only an *unrecognized integer* maps to `"Unknown"`. → R14, R17
- **Why:** These are different situations. An unrecognized integer means "upstream added a
  code we don't know yet" — valid data, so degrade gracefully. A string or `null` means
  "upstream broke its contract" — the data can't be trusted, so fail loudly. Treating both
  as `"Unknown"` would hide real integration problems.

### D6 — Duplicate query parameters: **first wins**
- **Question:** For `?lat=1&lat=50`, which value is used? *(raised during planning, F1)*
- **Decision:** The first occurrence; later ones are ignored, not validated. → R21
- **Why:** It's the common convention and what standard query parsers (`URLSearchParams.get`)
  do, so there's no surprise for client authors. Rejecting duplicates would contradict the
  forgiving stance of D1.
- **Trade-off accepted:** `?lat=1&lat=abc` succeeds with `lat=1` rather than reporting `abc`.

### D7 — Base URL config: **empty = unset, trailing slash tolerated**
- **Question:** What if `OPEN_METEO_BASE_URL` is `""` or ends in `/`? *(raised during planning, F2, F3)*
- **Decision:** Empty falls back to the default; a trailing slash is ignored. → R11
- **Why:** An empty URL is never a valid intent — it's almost always a blank app setting in
  the Azure portal. Trailing slashes are a common copy-paste difference and must not
  produce `//v1/forecast`, which some servers reject.

## 9. Changelog

| Date       | Change |
|------------|--------|
| 2026-11-07 | Draft created. |
| 2026-11-07 | Review: resolved open questions as D1–D5; added R19, R20, §4.1; tightened R4, R5, R10, R14, R17. Status → Approved. |
| 2026-11-07 | Amendment from planning feedback (plan §9 F1–F3): added R21 / D6 (duplicate params), clarified R11 / D7 (empty and trailing-slash base URL). |
| 2026-11-08 | Implemented (tasks T1–T13). All acceptance criteria met; no behavior changes from the approved spec. Status → Implemented. |
| 2026-11-08 | R15, R16, N3 amended by Spec 002 (pointers added; original wording kept). |
