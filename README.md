# Spec-Driven Experiment: Weather Summary Function App

A small Azure Function App (TypeScript, Node.js v4 programming model) that wraps the
public [Open-Meteo](https://open-meteo.com/) API. Built to practice spec-driven development.

## Workflow

Every change follows the same loop. No code is written until its spec is approved.

1. **Spec** — `specs/NNN-name.md`: what and why. Behavior as testable rules. No implementation details.
2. **Review** — resolve open questions, tighten wording. Status moves `Draft` → `Approved`.
3. **Plan** — `specs/NNN-name.plan.md`: how. Files, modules, libraries, data shapes.
4. **Tasks** — `specs/NNN-name.tasks.md`: small ordered steps, each pointing back to rule IDs.
5. **Implement** — write a test per rule, then the code that makes it pass.
6. **Change** — new behavior means editing or adding a spec first, then repeating.

## Specs

| ID  | Title                     | Status |
|-----|---------------------------|--------|
| 001 | Current weather endpoint ([spec](specs/001-current-weather.md), [plan](specs/001-current-weather.plan.md), [tasks](specs/001-current-weather.tasks.md)) | ✅ Done |
| 002 | Upstream resilience: timeouts & retries ([spec](specs/002-upstream-resilience.md), [plan](specs/002-upstream-resilience.plan.md), [tasks](specs/002-upstream-resilience.tasks.md)) | ✅ Done |
| 003 | Scheduled weather snapshots ([spec](specs/003-weather-snapshots.md), [plan](specs/003-weather-snapshots.plan.md), [tasks](specs/003-weather-snapshots.tasks.md)) | In progress |
| 004 | Deploy to Azure           | Planned |

## Prerequisites

- Node.js 22+ (`engines` in package.json)
- Azure Functions Core Tools v4 (`winget install Microsoft.Azure.FunctionsCoreTools`)

## Running locally

```sh
npm install
cp local.settings.example.json local.settings.json   # first time only

npm test              # all tests; no network, no storage needed

npm run azurite       # terminal 1 — Azure Storage emulator (required since Spec 003)
npm start             # terminal 2 — builds, then `func start`
```

| Function | Trigger | Try it |
|----------|---------|--------|
| `weather` | HTTP GET | `curl "http://localhost:7071/api/weather?lat=47.6&lon=-122.3"` |
| `snapshots` | Timer, every 30 min | Run now: `curl -X POST http://localhost:7071/admin/functions/snapshots -H "Content-Type: application/json" -d "{}"` |

Snapshots are stored in the `weathersnapshots` table in Azurite (view with Azure Storage Explorer).
