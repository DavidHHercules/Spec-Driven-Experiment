# Plan 003: Scheduled Weather Snapshots

- **Implements:** [Spec 003](003-weather-snapshots.md) (Approved)
- **Builds on:** Plans [001](001-current-weather.plan.md), [002](002-upstream-resilience.plan.md)
- **Status:** Approved
- **Created:** 2026-11-08

## 1. Shape of the change

```
src/functions/weather.ts ──► handleWeatherRequest ──┐
                                                     ├──► getCurrentWeather  (NEW, shared — N7)
src/functions/snapshots.ts ─► runSnapshots ─────────┘        config → URL → runWithRetries(fetchAttemptOnce)
       (NEW timer)              (NEW core)
                                    │
                                    ├──► parseLocations      (NEW, pure)
                                    └──► SnapshotStore       (NEW interface, injected — N8)
                                              ▲
src/storage/tableSnapshotStore.ts ────────────┘  (NEW, Azure Table SDK — only file that knows about Tables)
```

Order of work: **extract the shared fetch first** (pure refactor, all 213 tests green), then
build the new feature on top of it — same approach that worked for Plan 002.

## 2. Key design choices

### 2.1 Writing to Table Storage: SDK, not an output binding

Azure Functions offers a Table **output binding**: the function returns rows, and the host
writes them after the function finishes. It's less code, but:

| Need | Output binding | SDK (`@azure/data-tables`) |
|------|----------------|----------------------------|
| R45: a storage failure fails *that location only* | ✗ Writes happen after the function returns; one failure fails the whole invocation, and we can't tell which row | ✓ Each write awaited and handled individually |
| R44: overwrite an existing snapshot | Depends on binding semantics | ✓ `upsertEntity(entity, 'Replace')` — explicit |
| R48: accurate `saved=N` | ✗ We log before writes happen | ✓ Counted after each write succeeds |
| N8: testable without storage | Core returns rows — testable | ✓ Behind an injected `SnapshotStore` interface |

**Choice: SDK**, behind a two-method interface so the core never imports it.

### 2.2 Storage connection
Uses the `AzureWebJobsStorage` connection string — the storage account the Function App
already requires (D15). Locally that's `UseDevelopmentStorage=true` → Azurite.
Production authentication (managed identity instead of a connection string) is a deployment
concern → **Spec 004**.

### 2.3 Table keys (spec §5 left this to the plan)
| Table Storage key | Value | Why |
|-------------------|-------|-----|
| `PartitionKey` | `locationId` | All of one location's history in one partition → fast "history for Seattle" queries later |
| `RowKey` | `observedAt` (e.g. `2026-11-08T06:30`) | Unique per location per observation (R44). ISO format sorts chronologically as a string |

The table is created on first use (ignoring "already exists"), once per process.

### 2.4 Local storage emulator
`azurite` as a **devDependency pinned to 3.35.0** — the last version supporting Node 20
(3.36+ requires Node ≥ 21; another reason for the Node 22 upgrade in Spec 004).
`npm run azurite` starts it with data in `.azurite/` (git- and func-ignored).

## 3. Modules

### `src/core/getCurrentWeather.ts` — NEW (extracted, N7)
```ts
export async function getCurrentWeather(lat: number, lon: number, deps: Deps, logPrefix: string)
  : Promise<{ outcome: AttemptOutcome; attempts: number; startedAt: Date; finishedAt: Date }>;
```
Resolves resilience config (logging R33 warnings), resolves base URL, builds the URL, runs
`runWithRetries(fetchAttemptOnce)`. Moved verbatim from `handleWeatherRequest`.

**Subtlety:** today config warnings are logged *before* query validation (R33: every
invocation). Extraction must keep that, so `handleWeatherRequest` keeps calling
`resolveResilienceConfig` first and passes the config in. Signature therefore takes `config`:
```ts
getCurrentWeather(lat, lon, config: ResilienceConfig, deps, logPrefix)
```

### `src/core/locations.ts` — NEW (R36–R40)
```ts
export interface Location { id: string; lat: number; lon: number }
export const MAX_LOCATIONS = 10;
export function parseLocations(raw: string | undefined):
  { locations: Location[]; warnings: string[]; skipped: number };
```
Split on `;`, trim, ignore empty segments (so a trailing `;` is fine). Each entry: `id=lat,lon`;
id regex `/^[a-z0-9-]{1,32}$/`; coordinates via existing `parseCoordinate` + range checks
(reuse, don't re-implement Spec 001 §4.1). Duplicate check runs on valid entries (F6).

### `src/core/snapshots.ts` — NEW (R35, R39–R48)
```ts
export const SNAPSHOT_SCHEDULE = '0 */30 * * * *';   // R34 — exported so a test can pin it
export const SNAPSHOT_TABLE = 'weathersnapshots';

export interface Snapshot { locationId; lat; lon; observedAt; fetchedAt; tempC; windKph; weatherCode; condition }
export interface SnapshotStore { upsert(s: Snapshot): Promise<void> }

export async function runSnapshots(
  deps: Deps & { store: SnapshotStore },
  opts: { isPastDue: boolean },
): Promise<RunSummary>;                         // throws SnapshotRunFailedError when R46 applies
```
1. `isPastDue` → warn (R35).
2. `parseLocations(settings.SNAPSHOT_LOCATIONS)` → log warnings; none → warn, summary, return (R39).
3. `resolveResilienceConfig` once per run (warnings logged once per run, not once per location).
4. `Promise.all(locations.map(processLocation))` (R42) — each `processLocation` **never rejects**:
   fetch → not ok → failed; ok → build Snapshot → `store.upsert` → catch → failed.
5. Log summary (R48). If attempted ≥ 1 and saved = 0 → throw (R46), *after* the summary.

### `src/storage/tableSnapshotStore.ts` — NEW
```ts
export function snapshotToEntity(s: Snapshot): TableEntity;   // pure, unit-tested
export function createTableSnapshotStore(connectionString: string): SnapshotStore;
```
Lives outside `src/core` because it imports the Azure SDK (keeps N2 true for the core).

### `src/functions/snapshots.ts` — NEW adapter
```ts
app.timer('snapshots', {
  schedule: SNAPSHOT_SCHEDULE,
  handler: async (timer: Timer, context) => runSnapshots({ ...realDeps, store }, { isPastDue: timer.isPastDue }),
});
```
`realDeps` (fetch, clock, settings, log mapping) is now duplicated between two adapters →
extract `src/functions/runtimeDeps.ts`.

## 4. Configuration

| Setting | Local value | Notes |
|---------|-------------|-------|
| `AzureWebJobsStorage` | `UseDevelopmentStorage=true` | **Changed** from `""`. Required for timers (N9) and used for the table. |
| `SNAPSHOT_LOCATIONS` | `seattle=47.6,-122.3; london=51.5072,-0.1276; tokyo=35.6764,139.65` | Example in `local.settings.example.json` |

Consequence: from now on, **Azurite must be running for `func start`** (even for the HTTP
function, since the host now has storage configured). README updated accordingly.

## 5. Test strategy

| File | Covers | Notes |
|------|--------|-------|
| `getCurrentWeather.test.ts` | extraction is behavior-neutral | Light — the 213 existing tests are the real safety net |
| `locations.test.ts` | R36–R40, F6 | Table-driven, like `validate.test.ts` |
| `snapshots.test.ts` | R35, R39, R41–R48 | `fakeStore()` records upserts; can be told to fail for specific location ids. Fake fetch routes **by URL latitude** (concurrent calls make order-based scripting unreliable) |
| `tableSnapshotStore.test.ts` | §5 fields, §2.3 keys | `snapshotToEntity` only (pure) |
| Manual (T-acceptance) | Spec §8 against Azurite + `func start` | Trigger via `POST /admin/functions/snapshots`; read rows back with a small script |

**New fake:** `fakeFetchByLat({ '47.6': [steps…], '51.5072': [steps…] })` — each location gets
its own scripted sequence regardless of call order.

## 6. Traceability

| Rule | Module | Test |
|------|--------|------|
| R34 | snapshots (`SNAPSHOT_SCHEDULE`), adapter | snapshots.test (constant) + inspection |
| R35 | snapshots | snapshots.test |
| R36–R40 | locations | locations.test |
| R39 | snapshots | snapshots.test |
| R41 | getCurrentWeather (shared) | snapshots.test (retries happen per location) |
| R42 | snapshots | snapshots.test (slow location doesn't delay a fast one's save) |
| R43, R44 | snapshots + tableSnapshotStore | snapshots.test, tableSnapshotStore.test, manual |
| R45–R47 | snapshots | snapshots.test |
| R48 | snapshots | snapshots.test |
| N7 | getCurrentWeather | both handlers call it |
| N8 | `SnapshotStore` interface | no test touches Azurite |
| N9 | config, README | manual |

## 7. Spec feedback (gaps found while planning)

| # | Gap | Resolution |
|---|-----|------------|
| F6 | `a=bad; a=1,2` — is the second entry a "duplicate" of an invalid first one? | No: only **valid** entries claim an id. The invalid one is skipped; the second is used. Spec R38 clarified. |
| F7 | Spec §4 intro still says "Rules marked *(proposed Dn)*" after approval | Wording fix only. |

## 8. Risks

- **Concurrent fakes.** Order-based fake fetch would be flaky with `Promise.all` → mitigated by routing fakes by latitude.
- **Azurite + Node 20.** Pinned to 3.35.0; verified at T-acceptance.
- **`UseDevelopmentStorage=true` support in `@azure/data-tables`.** Expected to work; verified at T-acceptance. Fallback: Azurite's explicit connection string.
- **Host now needs Azurite to start.** A friction point for anyone only working on the HTTP function; documented in README.
- **Azurite 3.35.0 dev-only vulnerabilities** *(found in T28)*: `npm audit` reports 17 issues in
  Azurite's own dependency tree; production dependencies report **0**. Accepted: Azurite is a
  local emulator, a devDependency, and never deployed. Resolved by upgrading Node and Azurite
  together in Spec 004.
