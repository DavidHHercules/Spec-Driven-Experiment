# Spec 002: Upstream Resilience — Timeouts & Retries

- **Status:** Implemented
- **Author:** David Hercules
- **Created:** 2026-11-08
- **Approved:** 2026-11-08
- **Implemented:** 2026-11-08
- **Amends:** [Spec 001](001-current-weather.md) — R15, R16, N3 (see §6)

## 1. Goal

Make `GET /api/weather` behave predictably when Open-Meteo is slow or briefly failing:

1. **Bounded latency** — a caller always gets an answer within a known time, instead of
   waiting on a hung upstream request.
2. **Absorb transient failures** — a single blip upstream should not become an error for
   the caller.
3. **Distinguishable failures** — callers (and on-call engineers) can tell "upstream is
   slow" apart from "upstream is down / broken".

## 2. Scope

### In scope
- A time limit on each upstream request
- Retrying upstream failures that are likely to be transient, with backoff
- A new error code for timeouts
- Logging of each failed attempt
- Tuning timeout and attempt count through app settings

### Out of scope
- Caching or serving stale data when upstream is down
- Circuit breakers (stop calling upstream after repeated failures across requests)
- Sending `Retry-After` to *our* callers
- Honoring upstream `Retry-After` (429 is not retried — see D10)
- A separate total-time budget (see D11)
- Jitter on backoff (see D12)
- Changing behavior for input validation (R2–R9) or response shape (Spec 001 §3)

## 3. Terminology

| Term | Meaning |
|------|---------|
| **Attempt** | One HTTP request to Open-Meteo, from sending it until its body is fully read. A single call to our endpoint may make several. |
| **Attempt timeout** | Max time one attempt may take before it is abandoned. |
| **Transient failure** | An attempt failure that might succeed if tried again (R25). |
| **Permanent failure** | An attempt failure that will not improve on retry (R26). |
| **Backoff** | The wait between a failed attempt and the next one. |

## 4. Behavior rules

Rule IDs continue from Spec 001 so every ID in the project is unique.

### Timeouts

- **R22** — Given an attempt (including reading its body) has not completed within the attempt timeout, then it is abandoned and counts as a *timeout* failure. The attempt timeout defaults to **2000 ms** (R32). *(D8)*
- **R23** — There is no separate total-time budget. Worst-case latency is bounded by
  `max attempts × attempt timeout + sum of backoffs`:
  - with defaults: 3 × 2000 + 250 + 500 = **6750 ms**
  - with the largest allowed settings (R32): 4 × 5000 + 250 + 500 + 1000 = **21 750 ms** *(D11)*
- **R24** — Given the final outcome (R29) is a timeout, then respond `504` with code `UPSTREAM_TIMEOUT`.

### Retries

- **R25** — These attempt failures are **transient** and are retried: *(D10)*
  - network-level failure (Spec 001 R16), **including a connection dropped while reading the body** of a 2xx response *(F4)*
  - timeout (R22)
  - upstream status **500, 502, 503, 504**
- **R26** — All other failures are **permanent** and are never retried, including:
  - any other upstream status, **including 429** and all other 4xx
  - `UPSTREAM_BAD_RESPONSE` (Spec 001 R17) — a malformed 2xx body will not fix itself
- **R27** — Given an attempt fails transiently and fewer than max attempts (default **3**, R32) have been made, then another attempt is made after a backoff. The backoff before attempt *n* (n ≥ 2) is `250 × 2^(n−2)` ms: **250, 500, 1000** ms. *(D9, D12)*
- **R28** — Given an attempt succeeds, then no further attempts are made and the response is exactly as in Spec 001 (R1, R12–R14).
- **R29** — Given no attempt succeeds, then the response is determined by the **last** attempt's failure: *(D13)*
  - timeout → `504 UPSTREAM_TIMEOUT` (R24)
  - network failure or non-2xx status → `502 UPSTREAM_ERROR`
  - bad response → `502 UPSTREAM_BAD_RESPONSE`

### Logging

- **R30** — Each failed attempt logs one error line including: attempt number, max attempts, failure kind (`network` / `timeout` / `status N` / `bad response`), its detail, and whether a retry will follow.
- **R31** — The success log line (Spec 001 N3) additionally includes `attempts=N`. Its `upstreamMs` is the total time from the first attempt starting to the successful response.

### Configuration *(D14)*

- **R32** — Two app settings tune the behavior. Each falls back to its default when unset or empty.

  | Setting | Default | Valid values |
  |---------|---------|--------------|
  | `UPSTREAM_TIMEOUT_MS` | 2000 | integer 100–5000 |
  | `UPSTREAM_MAX_ATTEMPTS` | 3 | integer 1–4 |

  Backoff delays are not configurable.
- **R33** — Given a setting is present but invalid (not an integer in its range, e.g. `abc`, `0`, `2.5`, `9999`), then its default is used and a warning naming the setting and the bad value is logged on each invocation. The endpoint keeps working. Surrounding whitespace is trimmed before validation, so `" 3 "` is valid (consistent with D2). *(F5)*

## 5. Error codes (additions)

| Code | Status | Meaning |
|------|--------|---------|
| `UPSTREAM_TIMEOUT` | 504 | Upstream did not respond in time. *New.* |
| `UPSTREAM_ERROR` | 502 | Upstream unreachable or returned an error status. *Unchanged.* |
| `UPSTREAM_BAD_RESPONSE` | 502 | Upstream responded 2xx with unusable data. *Unchanged.* |

## 6. Changes to Spec 001

Spec 002 does not rewrite Spec 001's history. Spec 001 keeps its rules with a note pointing
here; this table is the authoritative "before → after".

| Rule | Before (Spec 001) | After (Spec 002) |
|------|-------------------|------------------|
| R15 | Non-2xx → `502 UPSTREAM_ERROR` | Still the final outcome, but 500/502/503/504 are retried first (R25). |
| R16 | Network failure → `502 UPSTREAM_ERROR` | Still the final outcome, but retried first (R25). |
| N3 | Success log has lat, lon, upstream ms | Adds `attempts=N`; `upstreamMs` spans all attempts (R31). |
| — | A hung upstream request hangs our function | Bounded by R22 / R23. |

## 7. Non-functional requirements

- **N4** — Tests for timeouts and backoff must not actually wait. Sleeping and timeouts are injected (extending Spec 001's `Deps`), so the full suite stays fast.
- **N5** — Worst-case latency (R23) must stay below typical client HTTP timeouts (~30 s) and the Azure Functions host timeout. The R32 ranges are chosen so this holds for *every* valid configuration.
- **N6** — An abandoned attempt must actually be cancelled (via `AbortSignal`), not left running in the background.

## 8. Decisions

Decided 2026-11-08 by Claude at David's request, as proposals a code owner would normally approve.
Q1–Q7 from the draft map to D8–D14.

### D8 (Q1) — Attempt timeout: **2000 ms**
- **Why:** Observed Open-Meteo latency in T12 was ~80–400 ms, so 2 s is ~5× the slowest
  observation — generous for a healthy upstream, short enough to leave room for retries.
- **Trade-off accepted:** a genuinely slow-but-working upstream (> 2 s) will time out.
  Tunable via `UPSTREAM_TIMEOUT_MS` without a deploy if that turns out to be common.

### D9 (Q2) — Max attempts: **3**
- **Why:** The request is a `GET` (safe to repeat) to a free API, so extra load costs us
  nothing and two retries cover the common "one or two blips" case. 3 is a widely used
  default, which makes the behavior unsurprising to others.
- **Trade-off accepted:** during a real outage we send 3× the requests. Acceptable at our
  traffic level; a circuit breaker would be the answer at scale (out of scope).

### D10 (Q3) — Retryable: **network, timeout, 500/502/503/504. Not 429.**
- **Why 5xx:** server-side failures are the classic transient case. 500 is included because
  from outside we can't distinguish "bug" from "overloaded" — one quick retry is cheap.
- **Why not 429:** Open-Meteo's free tier limits are per minute/hour/day. A 429 almost
  always means a quota is exhausted, which a retry 250 ms later cannot fix — it only adds
  load. Honoring `Retry-After` properly could mean waiting minutes, which conflicts with
  bounded latency.
- **Trade-off accepted:** a brief per-minute rate-limit hit becomes a 502 instead of
  succeeding after a wait.

### D11 (Q4) — Total budget: **derived, not a separate setting**
- **Why:** With D8, D9 and D12 the worst case is already bounded (6.75 s by default) and
  computable. A separate budget would add a second clock, clipped attempt timeouts, and
  rules for "is there enough time left to retry?" — real complexity for no current need.
  Instead, R32's ranges are chosen so even the worst valid configuration stays under 30 s (N5).
- **Trade-off accepted:** worst-case latency changes when settings change. That's why R23
  states it as a formula and documents both the default and maximum values.

### D12 (Q5) — Backoff: **exponential 250 / 500 / 1000 ms, no jitter**
- **Why exponential:** gives a struggling upstream progressively more room; standard practice.
- **Why no jitter:** jitter prevents many clients retrying in lockstep. We are a single, low-
  traffic caller, so that risk is minimal — and deterministic delays keep tests exact.
- **Trade-off accepted:** if this ever scales out to many instances, revisit jitter.

### D13 (Q6) — Mixed failures: **last attempt wins**
- **Why:** The last attempt is the most recent evidence of upstream's state, so it's the
  most useful thing to tell the caller. It's also the simplest rule to state and test.
  The full history is not lost — every attempt is logged (R30).
- **Trade-off accepted:** "timeout, timeout, 503" reports 502, even though most attempts
  timed out.

### D14 (Q7) — Configuration: **app settings with defaults; invalid → default + warning**
- **Why app settings:** being able to tune behavior in the Azure portal without a deploy is
  a core Function App skill and the realistic way ops would respond to a slow upstream.
- **Why fall back instead of failing:** a typo in a tuning setting shouldn't take the whole
  endpoint down. The warning (R33) makes the mistake visible in logs.
- **Why log on every invocation:** simplest stateless approach; the noise is a feature —
  it's a misconfiguration that should be fixed, not quietly tolerated.
- **Trade-off accepted:** a misconfiguration can go unnoticed if nobody reads logs.

## 9. Acceptance criteria

- [x] Every rule R22–R33 has at least one automated test.
- [x] Full test suite runs in under 5 seconds (proves N4 — no real waiting).
- [x] Locally, with `OPEN_METEO_BASE_URL` pointing at a server that accepts connections but never responds, the endpoint returns `504 UPSTREAM_TIMEOUT` in 6.75–7.75 s with default settings.
- [x] Locally, with `UPSTREAM_TIMEOUT_MS=abc`, the endpoint still works and logs a warning naming the setting.
- [x] All Spec 001 tests still pass, except those deliberately updated per §6 (each update noted in the commit message).

## 10. Changelog

| Date       | Change |
|------------|--------|
| 2026-11-08 | Draft created with open questions Q1–Q7. |
| 2026-11-08 | Review: resolved Q1–Q7 as D8–D14. Replaced placeholders; R23 rewritten from "total budget" to a derived bound; added R33 (invalid config). Status → Approved. |
| 2026-11-08 | Amendment from planning feedback (plan §8): R25 clarifies mid-body connection drops are network failures (F4); R33 clarifies whitespace is trimmed (F5). |
| 2026-11-08 | Implemented (tasks T14–T22). All acceptance criteria met: 504 in 6.97 s against a silent upstream; suite runs in 1.4 s. Status → Implemented. |
