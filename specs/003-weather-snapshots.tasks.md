# Tasks 003: Scheduled Weather Snapshots

- **Implements:** [Spec 003](003-weather-snapshots.md) via [Plan 003](003-weather-snapshots.plan.md)
- **Created:** 2026-11-08

Same rules as before: in order, one task = one commit, tests first, stop and raise spec gaps.
T23 is a refactor: **no test assertions may change.**

## Progress

| Task | Title | Rules | Status |
|------|-------|-------|--------|
| T23 | Refactor: extract `getCurrentWeather` | N7 | ☑ |
| T24 | `parseLocations` | R36–R40, F6 | ☑ |
| T25 | Fakes: `fakeFetchByLat`, `fakeStore` | N8 | ☑ |
| T26 | `runSnapshots` — success path | R34, R39, R41–R44, R48 | ☐ |
| T27 | `runSnapshots` — failures and late runs | R35, R45–R48 | ☐ |
| T28 | Table store, timer adapter, Azurite setup | R43, R44, N9 | ☐ |
| T29 | Local acceptance | §8 | ☐ |
| T30 | Acceptance review | §8 | ☐ |

---

## T23 — Refactor: extract `getCurrentWeather`

Move config-aware fetch-with-retries out of `handleWeatherRequest` into
`src/core/getCurrentWeather.ts` (plan §3). Config is still resolved before query validation.

**Done when**
- [x] All 213 tests pass with no test changes.
- [x] `handleWeatherRequest` no longer imports `runWithRetries` or `fetchAttemptOnce`.

## T24 — `parseLocations`

**Tests first** (`locations.test.ts`):
- [x] R36: spec example parses to two locations; whitespace ignored; trailing `;` ignored.
- [x] R37: id rules — `a`, `new-york`, 32 chars ok; uppercase, `_`, space, 33 chars, empty → invalid.
- [x] R37: coordinate rules reuse §4.1 + ranges (`1e1`, `91`, `-181` → invalid).
- [x] R37: malformed entries (`seattle`, `seattle=47.6`, `=1,2`, `a=1,2,3`) → invalid.
- [x] R38: invalid entry skipped with a warning quoting it; others kept; `skipped` counted.
- [x] R38: duplicate valid id → later one skipped with warning.
- [x] F6: `a=bad; a=1,2` → second entry used.
- [x] R39: unset / empty / whitespace → no locations, no warnings (caller warns).
- [x] R40: 12 valid → first 10 kept, one warning, `skipped` = 2.

## T25 — Fakes

`fakeFetchByLat(map)` (scripted steps per latitude, records calls) and
`fakeStore({ failFor?: string[] })` (records upserts in a Map keyed by identity, so overwrite
is observable; throws for listed location ids).

**Done when**
- [x] Used by T26/T27; typecheck passes.

## T26 — `runSnapshots`: success path

**Tests first** (`snapshots.test.ts`):
- [ ] R34: `SNAPSHOT_SCHEDULE === '0 */30 * * * *'`.
- [ ] R43: two locations → two snapshots with all §5 fields.
- [ ] R44: same location + same `observedAt` across two runs → one stored record (overwritten).
- [ ] R44: different `observedAt` → two records.
- [ ] R41: a location whose first attempt is 503 is retried and saved (Spec 002 behavior applies).
- [ ] R42: a location stuck in backoff doesn't delay another location's save.
- [ ] R39: no valid locations → warning, zero fetch calls, resolves (no throw).
- [ ] R48: summary line `saved=2 failed=0 skipped=0 durationMs=…`.

## T27 — `runSnapshots`: failures and late runs

**Tests first**:
- [ ] R45: one location fails upstream → others saved; failure logged with id and reason.
- [ ] R45: storing one location fails → others saved; counted as failed.
- [ ] R46: all attempted locations fail → throws **after** logging the summary.
- [ ] R47: 1 ok + 2 failed → resolves.
- [ ] R35: `isPastDue` → warning, run proceeds normally.
- [ ] R48: `skipped` reflects invalid + excess config entries.
- [ ] Spec 002 R33: config warnings logged once per run, not once per location.

## T28 — Table store, timer adapter, Azurite setup

- `src/storage/tableSnapshotStore.ts` (+ `@azure/data-tables`), `snapshotToEntity` tested.
- `src/functions/runtimeDeps.ts` shared by both adapters; `src/functions/snapshots.ts` timer.
- `azurite@3.35.0` devDependency, `npm run azurite`, `.azurite/` ignored.
- `local.settings.example.json`: `AzureWebJobsStorage=UseDevelopmentStorage=true`, sample `SNAPSHOT_LOCATIONS`.
- README: Azurite now required for `func start`.

**Done when**
- [ ] `snapshotToEntity` test: PartitionKey = id, RowKey = observedAt, all §5 fields present.
- [ ] Build, typecheck, all tests pass; `@azure/data-tables` not imported anywhere in `src/core`.

## T29 — Local acceptance (Azurite + `func start`)

- [ ] Host lists both functions: `weather` (HTTP) and `snapshots` (timer).
- [ ] Manual trigger (`POST /admin/functions/snapshots`) stores one row per configured location.
- [ ] Second trigger within the same 15-min window → still one row per location (R44).
- [ ] One invalid entry in `SNAPSHOT_LOCATIONS` → valid ones stored, summary shows `skipped=1`.
- [ ] `GET /api/weather` still returns 200.

## T30 — Acceptance review

- [ ] Every rule R34–R48 has a test whose name starts with its ID.
- [ ] All pre-existing tests pass unchanged.
- [ ] Spec §8 ticked; statuses updated; README → Done.
