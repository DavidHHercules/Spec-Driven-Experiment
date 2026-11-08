# Spec 003: Scheduled Weather Snapshots

- **Status:** Approved
- **Approved:** 2026-11-08
- **Author:** David Hercules
- **Created:** 2026-11-08
- **Depends on:** [Spec 001](001-current-weather.md) (fetching + mapping), [Spec 002](002-upstream-resilience.md) (timeouts + retries)

## 1. Goal

Build up a **history** of weather for a configured set of locations by capturing the
current conditions on a schedule and storing them.

Today the app only answers "what's the weather *now*?" when asked. After this spec it also
records the answer every 30 minutes, without anyone asking — the data a future feature
(trends, charts, "what was it like yesterday?") would need.

This is also the project's **second function**, living in the **same Function App** as
`GET /api/weather`, sharing its core code and settings.

## 2. Scope

### In scope
- A timer-triggered function (`snapshots`) in the existing Function App
- A configured list of locations
- Fetching current weather for each location, reusing Spec 001/002 behavior
- Storing one record per location per observation in Azure Table Storage
- Handling partial failure (some locations fail, others succeed)
- Logging a run summary

### Out of scope
- Reading snapshots back (no HTTP endpoint for history yet — future spec)
- Deleting old snapshots / retention policy *(D20)*
- Catching up on missed runs *(D22)*
- Batching multiple locations into one Open-Meteo request
- Alerting

## 3. Terminology

| Term | Meaning |
|------|---------|
| **Run** | One execution of the `snapshots` function, triggered by the schedule. |
| **Location** | A named coordinate pair from configuration, e.g. `seattle` → 47.6, −122.3. |
| **Snapshot** | One stored record: the weather at one location for one upstream observation time. |
| **Observation time** | Open-Meteo's `current.time` (Spec 001 `observedAt`). Updates every 15 minutes upstream. |

## 4. Behavior rules

Rule IDs continue from Spec 002. Rules marked *(proposed Dn)* depend on a decision in §9.

### Schedule

- **R34** — The `snapshots` function runs every 30 minutes, at :00 and :30 UTC (NCRONTAB `0 */30 * * * *`). *(D17)*
- **R35** — Given a run starts late (the platform reports it as *past due*), then a warning is logged and the run proceeds normally. Missed runs are **not** made up. *(D22)*

### Locations *(D16)*

- **R36** — Locations come from the app setting `SNAPSHOT_LOCATIONS`, formatted as `id=lat,lon` entries separated by `;`. Example: `seattle=47.6,-122.3; london=51.5072,-0.1276`. Whitespace around entries, ids and numbers is ignored.
- **R37** — A valid entry has:
  - `id`: 1–32 characters of lowercase `a–z`, digits, `-`
  - `lat`, `lon`: same format and ranges as the HTTP endpoint (Spec 001 §4.1, R6, R7)
- **R38** — Given an entry is invalid or its `id` repeats an earlier entry, then that entry is skipped with a warning quoting it; all valid entries are still processed.
- **R39** — Given `SNAPSHOT_LOCATIONS` is unset, empty, or has no valid entries, then a warning is logged, no upstream calls are made, and the run completes successfully.
- **R40** — Given more than **10** valid entries, then only the first 10 are used and a warning is logged. *(D23)*

### Fetching

- **R41** — Each location's weather is fetched with exactly the behavior of the HTTP endpoint's upstream call: same URL building, parsing, timeouts, retries, and settings (Spec 001 R10–R14, R17; Spec 002 R22–R33). *(D21)*
- **R42** — Locations are fetched **concurrently**; one slow location does not delay the others. *(D23)*

### Storing *(D15, D19)*

- **R43** — Each successfully fetched location is stored as one snapshot in the table `weathersnapshots`, with the fields in §5.
- **R44** — A snapshot is identified by **(location id, observation time)**. Given a snapshot with the same identity already exists, then it is overwritten. This is not an error. *(D19: two runs within one 15-minute upstream window store one record, not two.)*

### Failures *(D18)*

- **R45** — Given a location fails (final upstream outcome is not `ok`, or storing its snapshot fails), then: the failure is logged with the location id and reason; no snapshot is stored for it; other locations are unaffected.
- **R46** — Given at least one location was attempted and **all** of them failed, then the run ends as **failed** (the function throws after logging), so the platform records a failed execution.
- **R47** — Given at least one location succeeded, then the run ends as **succeeded**, even if others failed.

### Logging

- **R48** — Every run ends with one summary line: `snapshots run: saved=N failed=M skipped=K durationMs=D`, where `skipped` counts invalid/excess configuration entries.

## 5. Snapshot record

| Field | Type | Source |
|-------|------|--------|
| `locationId` | string | config (R36) |
| `lat`, `lon` | number | config |
| `observedAt` | string | upstream `current.time` (Spec 001 R12) |
| `fetchedAt` | string, ISO 8601 UTC | when our function received the response |
| `tempC` | number | Spec 001 R12 |
| `windKph` | number | Spec 001 R12 |
| `weatherCode` | integer | Spec 001 R12 |
| `condition` | string | Spec 001 §5 mapping |

How identity (R44) maps onto Table Storage keys is a plan decision.

## 6. Changes to existing specs

None. `GET /api/weather` is unchanged. The upstream-calling code is **shared**, not changed
(N7) — any later change to Spec 001/002 behavior applies to both functions.

## 7. Non-functional requirements

- **N7** — The snapshot function reuses the existing core modules for URL building, fetching, parsing, and retries. No second Open-Meteo client.
- **N8** — Tests make no network calls and need no storage emulator: storage is injected like `fetch`.
- **N9** — Local development uses **Azurite** (the Azure Storage emulator). Timer triggers require a storage account even locally, so `AzureWebJobsStorage` must point at Azurite (`UseDevelopmentStorage=true`).
- **N10** — Worst-case run duration stays well under the host timeout: with ≤ 10 locations fetched concurrently, it is roughly one location's worst case (Spec 002 R23, ≤ 21.75 s) plus storage time.

## 8. Acceptance criteria

- [ ] Every rule R34–R48 has at least one automated test (R34's schedule is verified by inspection of the registration plus a test of the exported schedule constant).
- [ ] Locally with Azurite + `func start`, triggering `snapshots` manually stores one row per configured location in `weathersnapshots`.
- [ ] Triggering twice within 15 minutes leaves one row per location, not two (R44).
- [ ] With one location pointed at an invalid entry and one valid, the valid one is stored and the summary shows `skipped=1`.
- [ ] `GET /api/weather` still behaves exactly as before; all existing tests pass unchanged.

## 9. Decisions

Proposed by Claude; all approved by David as written (2026-11-08).

### D15 — Storage: **Azure Table Storage**
- **Why:** Snapshots are small, uniform records keyed by (location, time) — exactly what a
  key-value table is for. The Function App *already requires* a storage account, so this adds
  no new Azure resource and costs almost nothing.
- **Alternatives:** Blob Storage (one JSON file per run — simple to write, awkward to query by
  location); Cosmos DB (powerful, but a new resource and cost for no current need).

### D16 — Locations: **`SNAPSHOT_LOCATIONS` app setting, `id=lat,lon;…`**
- **Why:** Changeable in the portal without a deploy, consistent with Spec 002's settings.
  The format is short enough to type into a portal field. Skipping bad entries with a warning
  matches D14's "a typo shouldn't take the feature down".
- **Alternatives:** a JSON file in the repo (versioned, but needs a deploy to change);
  JSON in an app setting (flexible, but painful to edit in a single-line portal field).

### D17 — Schedule: **every 30 min, hard-coded**
- **Why:** Upstream updates every 15 min, so 30 min captures every other observation —
  enough for trends at half the calls. Hard-coded because a schedule set from an app setting
  (`%SNAPSHOT_SCHEDULE%`) has no default: if the setting is missing, the function fails to
  load at all — a sharp edge for little benefit.
- **Alternatives:** every 15 min (every observation, double the calls); configurable schedule.

### D18 — Partial failure: **save what worked; fail the run only if everything failed**
- **Why:** One city's bad luck shouldn't discard nine good snapshots. But if *every* location
  fails, something systemic is wrong (upstream down, storage misconfigured) and the run should
  show as **failed** in monitoring rather than quietly "succeeding" with nothing saved.
- **Alternatives:** always succeed (failures only in logs — easy to miss); fail if anything fails
  (noisy — one flaky city marks every run failed).

### D19 — Duplicates: **identity = (location, observation time); overwrite**
- **Why:** Re-running (manual trigger, platform retry, overlapping runs) should be harmless —
  this is called **idempotency**. Keying on the *upstream* observation time means two runs inside
  one 15-minute window naturally produce the same identity, and overwriting with identical data
  is a no-op in effect.
- **Alternatives:** key on our run time (every run adds rows, including duplicates of the same
  observation); insert-only and treat conflicts as errors (makes re-runs fail).

### D20 — Retention: **keep everything (out of scope)**
- **Why:** 10 locations × 48 runs/day ≈ 175k small rows/year — trivial for Table Storage.
  Deleting data is easy to add later; un-deleting is impossible.

### D21 — Upstream behavior: **reuse Spec 001/002 exactly, including settings**
- **Why:** One client, one set of tuning knobs, one place to fix bugs (N7). A background job
  could afford longer timeouts, but separate settings would add configuration surface for a
  difference nobody has needed yet.

### D22 — Late / missed runs: **warn, run normally, no catch-up**
- **Why:** We can only fetch *current* weather — a catch-up run at 10:15 cannot capture what
  it was at 09:30. So catching up is impossible, not just unnecessary.

### D23 — Concurrency and cap: **all locations in parallel, max 10**
- **Why parallel:** keeps run time ≈ one location's worst case (N10) instead of 10× it.
- **Why 10:** bounds load on Open-Meteo's free tier (10 × 48 runs/day ≈ 480 calls/day, well under
  its daily limit, even with retries) and keeps a misconfigured list from fanning out to
  hundreds of parallel calls.

## 10. Changelog

| Date       | Change |
|------------|--------|
| 2026-11-08 | Draft created with proposed decisions D15–D23. |
| 2026-11-08 | Review: D15–D23 approved as proposed. Status → Approved. |
