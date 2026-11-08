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

- Node.js 20+
- Azure Functions Core Tools v4 (`winget install Microsoft.Azure.FunctionsCoreTools`)
