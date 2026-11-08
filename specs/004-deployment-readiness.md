# Spec 004: Deployment Readiness

- **Status:** Implemented (deployment itself pending a subscription — see docs/deploy.md §9)
- **Approved:** 2026-11-08
- **Implemented:** 2026-11-08
- **Author:** David Hercules
- **Created:** 2026-11-08
- **Depends on:** Specs [001](001-current-weather.md), [002](002-upstream-resilience.md), [003](003-weather-snapshots.md)

## 1. Goal

Make the Function App **deployable to Azure by running documented steps**, with nothing
left to figure out — even though no Azure subscription is available today.

"Ready" means: the Azure resources are defined as code, the code works with how Azure
authenticates (not just with Azurite), every push is automatically tested, a deploy
pipeline exists, and a first-time deployer has a runbook. Everything that *can* be verified
without a subscription *is* verified.

## 2. Scope

### In scope
- Infrastructure as code for every Azure resource the app needs
- Code changes so storage works with **managed identity** in Azure while still working with Azurite locally
- Continuous integration: test + build on every push and pull request
- A deploy pipeline (runs only when manually triggered, once Azure is set up)
- Verifying the deployment package contents locally
- A first-deployment runbook

### Out of scope
- Actually deploying (no subscription) — the runbook's steps are the hand-off
- Custom domains, API Management, private networking / VNet integration
- Multiple environments (dev/test/prod) — one environment, parameterized so more can be added
- Alerts and dashboards beyond what Application Insights provides by default
- Infrastructure-as-code testing against a live subscription (what-if / deployment tests)

## 3. Terminology

| Term | Meaning |
|------|---------|
| **IaC** | Infrastructure as code: Azure resources described in files, deployed by a tool, kept in git. |
| **Managed identity** | An identity Azure gives the Function App itself, so it can access storage without any key or password existing anywhere. |
| **OIDC (federated credential)** | Lets GitHub Actions log in to Azure with a short-lived token instead of a stored secret. |
| **Flex Consumption** | Azure Functions' current serverless hosting plan: pay per use, scales to zero, Linux. |
| **Deployment package** | The zip uploaded to Azure: compiled code, `host.json`, `package.json`, production `node_modules`. Its contents are controlled by `.funcignore` (R61). |

## 4. Requirements

Rule IDs continue from Spec 003. Deployment requirements are less "Given/When/Then" than
behavior rules; each is still written to be checkable.

### Infrastructure *(D24, D25, D27)*

- **R49** — All Azure resources are defined in **Bicep** under `infra/`. Deploying them to an empty resource group creates everything the app needs; the only manual steps are those in the runbook (R60).
- **R50** — Resources: a storage account; a Flex Consumption plan; a Linux Function App on **Node 22**; a Log Analytics workspace + Application Insights; the role assignments in R51.
- **R51** — **No storage keys or connection strings exist anywhere** (code, settings, pipeline, IaC outputs). The Function App's system-assigned managed identity accesses storage, with only these roles on the storage account:
  - host runtime + deployment package: *Storage Blob Data Owner*
  - host runtime: *Storage Queue Data Contributor*
  - snapshots (Spec 003): *Storage Table Data Contributor*
  The storage account has shared-key access **disabled**, so a key could not be used even if leaked.
- **R52** — Location, name prefix, and `SNAPSHOT_LOCATIONS` are template **parameters**; nothing environment-specific is hard-coded in the templates.
- **R53** — The Flex Consumption maximum instance count is a parameter defaulting to **10** — a cost ceiling for a public endpoint. *(D26)*

### Storage authentication in code

- **R54** — The snapshot store connects using, in priority order:
  1. `AzureWebJobsStorage` **connection string**, if set and non-empty (local / Azurite — unchanged behavior)
  2. otherwise `AzureWebJobsStorage__accountName` → `https://{account}.table.core.windows.net` with the **managed identity**
  3. otherwise: no store can be created → every location fails to store → the run fails (Spec 003 R46) with an error log naming both settings.
- **R55** — Using the identity path never requires a code or settings change locally: Azurite keeps using the connection string.

### Configuration in Azure

- **R56** — App settings in Azure: `AzureWebJobsStorage__accountName`, `APPLICATIONINSIGHTS_CONNECTION_STRING`, `SNAPSHOT_LOCATIONS`. `OPEN_METEO_BASE_URL`, `UPSTREAM_TIMEOUT_MS`, `UPSTREAM_MAX_ATTEMPTS` are **not set**, so code defaults apply (Specs 001/002) — they remain available as tuning knobs.

### Access *(D28)*

- **R57** — `GET /api/weather` stays **anonymous** (no function key). Abuse is bounded by R53's instance cap and Open-Meteo being free.

### Continuous integration *(D29)*

- **R58** — On every push and pull request, GitHub Actions runs on Node 22: `npm ci` → typecheck → tests → build. Any failure fails the workflow.

### Deployment pipeline *(D29, D30)*

- **R59** — A separate deploy workflow:
  - runs only when **manually triggered**
  - runs the full CI checks first and deploys only if they pass
  - logs in to Azure with **OIDC** (no stored Azure secrets; only non-secret IDs as GitHub variables)
  - deploys the package, then **smoke-tests** `GET /api/weather?lat=47.6&lon=-122.3` and fails the workflow unless it returns 200.

### Package and runbook

- **R60** — `docs/deploy.md` is a first-deployment runbook: prerequisites, creating the resource group, deploying `infra/`, setting up the OIDC federated credential, configuring GitHub variables, running the deploy workflow, verifying (both functions, App Insights logs), and how to roll back.
- **R61** — The deployment package contains only what runs in Azure: compiled `dist/`, `host.json`, `package.json`, production `node_modules`. It contains **no** `.ts` sources, tests, specs, scripts, `local.settings*.json`, `.azurite/`, or dev dependencies (Vitest, Azurite, TypeScript).

## 5. What "verified without a subscription" means

| Requirement | How it's verified locally |
|-------------|---------------------------|
| R49–R53 | Bicep compiles and passes the linter with zero warnings |
| R51 | Search of repo + compiled template finds no `AccountKey`, `listKeys`, or connection strings |
| R54, R55 | Unit tests for the three-way selection; Azurite path re-run under `func start` |
| R58 | Same commands the workflow runs, run locally on Node 22; workflow YAML validated |
| R59 | Workflow YAML validated; reviewed against R59's bullet list (can't execute without Azure) |
| R61 | Build the package locally and list its contents |
| R60 | Reviewed against R60's list |

Anything requiring a live subscription is explicitly listed as **unverified** in the runbook.

## 6. Changes to existing specs

- **Spec 003 plan §2.2** said storage auth would move to managed identity in Spec 004 — this is that change. No behavior rule changes; local behavior is identical (R55).

## 7. Non-functional requirements

- **N11** — The CI workflow completes in under 3 minutes.
- **N12** — Pipeline actions are pinned to major versions from their official publishers (`actions/*`, `azure/*`, `Azure/*`).
- **N13** — The repo stays deployable by someone who has only read the README and runbook.

## 8. Acceptance criteria

- [x] `bicep build` + `bicep lint` on `infra/main.bicep`: zero errors, zero warnings.
- [x] No secrets/keys found by the R51 search.
- [x] R54 selection covered by unit tests; local Azurite run still stores snapshots.
- [x] CI commands pass locally on Node 22; both workflow files parse as valid YAML with the expected triggers.
- [x] Locally built deployment package matches R61.
- [x] Runbook covers every R60 item, and lists what remains unverified.
- [x] All existing tests pass unchanged.

## 9. Decisions

Proposed by Claude; all approved by David as written (2026-11-08).

### D24 — IaC tool: **Bicep**
- **Why:** Azure's native IaC language — first-class support for new resource types like Flex
  Consumption, no state file to manage, and a free offline compiler + linter, which is exactly
  what we need to verify without a subscription.
- **Alternatives:** Terraform (multi-cloud, but needs remote state and its Azure provider can
  lag new features); ARM JSON (what Bicep compiles to — verbose); portal clicks (not repeatable).

### D25 — Hosting plan: **Flex Consumption**
- **Why:** Microsoft's recommended serverless plan for new apps: Linux, scales to zero, managed
  identity for host storage and deployment, per-function-group scaling (the HTTP function and
  the timer scale independently). The classic Consumption plan is the legacy option.
- **Alternatives:** classic Consumption (older, fewer identity options); Premium / Dedicated
  (always-on cost, unnecessary at this scale).

### D26 — Instance cap: **10 (parameter)**
- **Why:** An anonymous endpoint can be hammered; a cap bounds both cost and the load we push
  onto Open-Meteo. 10 is far beyond expected traffic and easy to raise.

### D27 — Storage auth: **system-assigned managed identity, shared keys disabled**
- **Why:** No secret to store, rotate, or leak. Disabling shared-key access means a leaked key
  would be useless anyway. System-assigned (vs user-assigned) because one app uses one
  identity and it's deleted with the app.
- **Cost of the choice:** R54 adds a small code path, since the Tables SDK needs a credential
  object instead of a connection string.

### D28 — `GET /api/weather` access: **stay anonymous**
- **Why:** It proxies free public data, holds no secrets, and has no per-user state. A function
  key would add a distribution problem (who gets it, how is it rotated) for little protection.
  D26 bounds the cost of abuse.
- **Alternatives:** function key (`authLevel: 'function'`); put API Management in front (out of scope).

### D29 — CI/CD: **GitHub Actions**
- **Why:** The repo is already on GitHub; Actions is free for this scale and has official Azure
  actions. OIDC means no Azure secret is ever stored in GitHub.

### D30 — Deploy trigger: **manual only (for now)**
- **Why:** No Azure environment exists yet, so an automatic deploy on every push to `main`
  would fail on every push. Manual trigger (`workflow_dispatch`) makes the pipeline ready but
  dormant. Switching to "deploy on merge to main" later is a one-line change.

### D31 — Verifying Bicep offline: **install the Bicep CLI locally**
- **Why:** It's the only way to actually *check* R49–R53 without Azure; a template that has
  never been compiled is untested code. Installed via `winget install Microsoft.Bicep`.
  (CI could also compile it — see plan.)

## 10. Changelog

| Date       | Change |
|------------|--------|
| 2026-11-08 | Draft created with proposed decisions D24–D31. |
| 2026-11-08 | Review: D24–D31 approved as proposed. Status → Approved. |
| 2026-11-08 | Implemented (tasks T31–T38). All acceptance criteria met without a subscription; items needing live Azure listed in docs/deploy.md §9. |
