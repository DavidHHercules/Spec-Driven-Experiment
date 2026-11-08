# Tasks 002: Upstream Resilience

- **Implements:** [Spec 002](002-upstream-resilience.md) via [Plan 002](002-upstream-resilience.plan.md)
- **Created:** 2026-11-08

Same rules as [Tasks 001](001-current-weather.tasks.md): in order, one task = one commit,
tests first, stop and raise spec gaps. Task IDs continue from Spec 001 (T14+).

**Refactor tasks (T14, T15) must not change behavior:** no test assertions may change,
only test *setup* (and only where the refactor forces it).

## Progress

| Task | Title | Rules | Status |
|------|-------|-------|--------|
| T14 | Refactor: `Deps.settings` + `log.warn` | — | ☑ |
| T15 | Refactor: extract `fetchAttemptOnce` | — | ☑ |
| T16 | Fake fetch upgrades | N4, N6 | ☑ |
| T17 | Attempt timeout + abort | R22, R24, N6 | ☑ |
| T18 | Resilience config | R32, R33, N5 | ☐ |
| T19 | Retry loop | R25–R27, R29, R30 | ☐ |
| T20 | Wire retries into the handler | R28, R29, R31 | ☐ |
| T21 | Adapter + local acceptance | R22, R24, R33, §9 | ☐ |
| T22 | Acceptance review | §9 | ☐ |

---

## T14 — Refactor: `Deps.settings` + `log.warn`

Replace `Deps.baseUrl` with `Deps.settings` (raw env-like map). Core resolves the base URL
via `resolveBaseUrl(settings.OPEN_METEO_BASE_URL)`. Add `warn` to the log interface. Adapter
passes `process.env` and maps `context.warn`.

**Done when**
- [x] All 133 existing tests pass; only `makeDeps` and the base-URL test's setup changed.
- [x] Build and typecheck pass.

## T15 — Refactor: extract `fetchAttemptOnce`

Add `AttemptOutcome` type. Move fetch → text → status check → JSON parse → `parseCurrent`
from `handleWeatherRequest` into `src/core/fetchAttempt.ts`. Handler maps outcome → response
and logs. No timeout yet.

**Done when**
- [x] All existing tests pass with no assertion changes.
- [x] `handleWeatherRequest` contains no `fetch`, `text()` or `JSON.parse` calls.

## T16 — Fake fetch upgrades

Per plan §6: `{ hang: true }`, `{ status, hangBody: true }`, calls recorded as `{ url, aborted }`.
`makeDeps` defaults `UPSTREAM_MAX_ATTEMPTS: '1'`.

**Done when**
- [x] Existing tests updated for the new `calls` shape (setup only) and pass.

## T17 — Attempt timeout + abort

**Tests first** (`fetchAttempt.test.ts`, fake timers):
- [x] R22: hanging fetch → `timeout` outcome exactly at the timeout, not before (advance `t−1` → pending; `+1` → settled).
- [x] R22: headers arrive but body hangs → `timeout` (timeout covers body read).
- [x] N6: the hanging request's signal was aborted.
- [x] Fast success → `ok`; no timers left pending afterwards (`vi.getTimerCount() === 0`).
- [x] Classification: network error → `network`; 503 → `status`; bad JSON / bad shape → `bad-response`.
- [x] F4: body stream errors mid-read (not timeout) → `network`.
- [x] R24 (handler): timeout outcome → `504 UPSTREAM_TIMEOUT`.

## T18 — Resilience config

**Tests first** (`config.test.ts`):
- [ ] R32: unset / empty → defaults 2000 / 3, no warnings.
- [ ] R32 / N5: boundaries 100, 5000, 1, 4 accepted.
- [ ] R33: `abc`, `0`, `2.5`, `-5`, `99`, `5001`, `9999` → default + warning naming setting and value.
- [ ] F5: `" 3 "` → 3, no warning.
- [ ] R33 (handler): warnings are logged via `log.warn` and the request still succeeds.

## T19 — Retry loop

**Tests first** (`retry.test.ts`, scripted outcomes, fake timers):
- [ ] R25: `network`, `timeout`, `status` 500/502/503/504 → retried.
- [ ] R26: `status` 429, 404, 400 and `bad-response` → not retried (1 attempt).
- [ ] R27: backoff timing exact — second attempt at 250 ms not 249; third at +500 ms not +499.
- [ ] R27: stops at `maxAttempts` (1, 3, 4); with 4 attempts the last backoff is 1000 ms.
- [ ] R28: success on attempt 2 → no attempt 3.
- [ ] R29: last outcome is returned (timeout, then 503 → 503).
- [ ] R30: each failed attempt logs `attempt n/N`, kind, detail, and `retrying in X ms` / `giving up`.

## T20 — Wire retries into the handler

**Tests first** (`handleWeatherRequest.test.ts`):
- [ ] R28: 503 then 200 → 200, 2 fetch calls.
- [ ] R29: 503 ×3 → 502 `UPSTREAM_ERROR`; timeout ×3 → 504; timeout, timeout, 503 → 502.
- [ ] R26: 429 → 502 after exactly 1 call, even with max attempts 3.
- [ ] R31: success log includes `attempts=2` and `upstreamMs` spanning both attempts and the backoff.
- [ ] Settings flow through: `UPSTREAM_MAX_ATTEMPTS='2'` → at most 2 calls.

## T21 — Adapter + local acceptance

Add `scripts/never-respond-server.js` (accepts TCP connections, never replies).

**Done when** (against `func start`)
- [ ] Normal request → 200; log shows `attempts=1`.
- [ ] Base URL → never-respond server → `504 UPSTREAM_TIMEOUT` in 6.75–7.75 s; log shows 3 attempts.
- [ ] `UPSTREAM_TIMEOUT_MS=abc` → still 200; warning in log naming the setting.

## T22 — Acceptance review

- [ ] Every rule R22–R33 has a test whose name starts with its ID.
- [ ] `npm test` completes in < 5 s (N4).
- [ ] Spec 002 §9 boxes ticked; statuses updated; README → Done.
