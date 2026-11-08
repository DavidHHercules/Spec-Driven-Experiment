# Plan 004: Deployment Readiness

- **Implements:** [Spec 004](004-deployment-readiness.md) (Approved)
- **Status:** Approved
- **Created:** 2026-11-08

## 1. New and changed files

```
infra/
├── main.bicep                 # NEW  all resources (R49–R53, R56)
└── main.bicepparam            # NEW  example parameter values
.github/workflows/
├── ci.yml                     # NEW  push / PR / reusable (R58)
└── deploy.yml                 # NEW  manual; calls ci.yml, then deploys + smoke test (R59)
scripts/
└── package.js                 # NEW  builds .deploy/ allowlist package; --check verifies R61
docs/
└── deploy.md                  # NEW  first-deployment runbook (R60)
src/storage/
└── tableSnapshotStore.ts      # CHANGED  resolveStorageTarget + createSnapshotStoreFromSettings (R54)
src/functions/snapshots.ts     # CHANGED  uses createSnapshotStoreFromSettings(process.env)
```

New runtime dependency: `@azure/identity` (requires Node ≥ 22 — consistent with `engines`).

## 2. Storage authentication (R54, R55)

```ts
export type StorageTarget =
  | { kind: 'connection-string'; connectionString: string }
  | { kind: 'identity'; tableUrl: string }               // https://{account}.table.core.windows.net
  | { kind: 'none' };

export function resolveStorageTarget(settings): StorageTarget;          // pure, unit-tested
export function createSnapshotStoreFromSettings(settings): SnapshotStore;
```

- `connection-string` → `TableClient.fromConnectionString` (unchanged Azurite path; insecure HTTP
  allowed only for `UseDevelopmentStorage=true` or an `http://` endpoint).
- `identity` → `new TableClient(tableUrl, table, new DefaultAzureCredential())`. In Azure this
  resolves to the Function App's managed identity; locally it would use `az login` if ever pointed at real storage.
- `none` → a store whose `upsert` rejects with a message naming **both** settings, so each
  location fails to store and Spec 003 R46 fails the run — no new failure path needed.

`DefaultAzureCredential` is constructed lazily (first upsert), so unit tests never touch it.

## 3. Infrastructure (`infra/main.bicep`)

| Resource | Key settings | Requirement |
|----------|--------------|-------------|
| Log Analytics workspace | PerGB2018, 30-day retention | R50 |
| Application Insights | workspace-based | R50, R56 |
| Storage account | Standard_LRS, `allowSharedKeyAccess: false`, no public blob access, TLS 1.2, OAuth default | R50, R51 |
| └ blob container `app-package` | Flex Consumption deployment package location | R50 |
| App Service plan | `FlexConsumption` / `FC1`, Linux | R50 / D25 |
| Function App | `functionapp,linux`, system-assigned identity, HTTPS only; `functionAppConfig`: runtime node 22, deployment storage via identity, `maximumInstanceCount` param | R50, R53 |
| 3 role assignments | Blob Data Owner, Queue Data Contributor, Table Data Contributor → app identity, scoped to the storage account | R51 |

App settings: `AzureWebJobsStorage__accountName`, `APPLICATIONINSIGHTS_CONNECTION_STRING`,
`SNAPSHOT_LOCATIONS` — nothing else (R56). `FUNCTIONS_WORKER_RUNTIME` is **not** set: on Flex
Consumption the runtime comes from `functionAppConfig.runtime`.

Parameters (R52): `location` (default: resource group's), `namePrefix` (3–11 lowercase
letters/digits — becomes part of the storage account name), `snapshotLocations`,
`maximumInstanceCount` (default 10, D26), `instanceMemoryMB` (default 2048).
Names: `{prefix}-{type}-{uniqueString(rg)}`; storage `{prefix}{13 chars of uniqueString}` (≤ 24, lowercase).

Outputs: function app name, default hostname, storage account name. **No secrets in outputs**
(also enforced by the Bicep linter rule `outputs-should-not-contain-secrets`).

## 4. Deployment package (R61)

`scripts/package.js` builds an **allowlist** package rather than relying on `.funcignore`'s
denylist:
1. Requires an up-to-date `dist/` (run after `npm run build`).
2. Recreates `.deploy/` with: `dist/`, `host.json`, `package.json`, `package-lock.json`.
3. Runs `npm ci --omit=dev --ignore-scripts` inside `.deploy/`.
4. `--check` mode verifies R61: required entries present; no `*.ts` (except `.d.ts` inside
   `node_modules`), no `test/`, `specs/`, `scripts/`, `infra/`, `local.settings*.json`, `.azurite/`;
   no dev packages (`vitest`, `azurite`, `typescript`) in `.deploy/node_modules`.

`npm run package` = build + package; `npm run package:check` = package + check. CI runs the
check, so R61 is verified on every push, not just once. `.deploy/` is git- and func-ignored.

Why allowlist: a denylist silently ships anything new nobody thought to exclude; an allowlist
ships only what's named.

## 5. Workflows

### `ci.yml` (R58, N11, N12)
Triggers: `push`, `pull_request`, `workflow_call` (so deploy can reuse it).
Steps on `ubuntu-latest`, Node 22 with npm cache: `npm ci` → `typecheck` → `test` →
`package:check` (includes build) → `az bicep build` + `az bicep lint` on `infra/main.bicep`.
`permissions: contents: read`.

### `deploy.yml` (R59, D30)
Trigger: `workflow_dispatch` only. `concurrency: deploy` (no overlapping deploys).
1. `ci` job: `uses: ./.github/workflows/ci.yml`.
2. `deploy` job (`needs: ci`, GitHub environment `production`):
   `npm ci` → `npm run package` → `azure/login@v2` with OIDC
   (`vars.AZURE_CLIENT_ID`, `vars.AZURE_TENANT_ID`, `vars.AZURE_SUBSCRIPTION_ID`) →
   `Azure/functions-action@v1` (`package: .deploy`, `sku: flexconsumption`) →
   look up hostname with `az functionapp show` (Flex apps may get non-predictable hostnames) →
   smoke test `GET /api/weather?lat=47.6&lon=-122.3` with retries for cold start; fail unless 200.
`permissions: id-token: write` (OIDC) + `contents: read`. No Azure secrets anywhere.

## 6. Verification plan (spec §5)

| Check | Command |
|-------|---------|
| Bicep compiles + lints clean | `bicep build infra/main.bicep` / `bicep lint infra/main.bicep` |
| No keys (R51) | grep repo + compiled ARM JSON for `AccountKey`, `listKeys`, `DefaultEndpointsProtocol`, `SharedAccessSignature` |
| R54 | unit tests; Azurite + `func start` snapshot run |
| R58 | run CI's commands locally; parse both YAML files (`js-yaml` via npx, not added to the project) |
| R61 | `npm run package:check` + list `.deploy/` top level |

## 7. Known unverifiable items (go in the runbook)

- Flex Consumption accepts the template as written (API version, `functionAppConfig` shape).
- The three role assignments are sufficient for the host on Flex Consumption with identity-based storage.
- `Azure/functions-action` with `sku: flexconsumption` deploys `.deploy/` correctly.
- The deployer identity's minimum required role (runbook uses *Contributor* on the resource group; least privilege is a follow-up).
- The smoke test passes against a real cold start within its retry window.

## 8. Spec feedback

None found during planning.
