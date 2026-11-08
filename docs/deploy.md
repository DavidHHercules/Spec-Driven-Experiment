# First Deployment Runbook

How to take this repo from "never deployed" to running in Azure. Written for someone who has
read the [README](../README.md) and has an Azure subscription. Implements
[Spec 004](../specs/004-deployment-readiness.md) R60.

> **Status of this runbook:** every step was written against the repo as it is, and everything
> that can be checked without a subscription *was* checked (see [§9](#9-what-has-not-been-verified)).
> It has **not yet been run end to end against real Azure**. Expect the first run to surface
> small corrections — fix them here, in the same commit as any template change.

## 0. What gets created

One resource group containing:

| Resource | Purpose |
|----------|---------|
| Function App (Flex Consumption, Linux, Node 22) | Runs `weather` (HTTP) and `snapshots` (timer) |
| Storage account (shared keys **disabled**) | Host runtime state, deployment package, `weathersnapshots` table |
| Application Insights + Log Analytics | Logs and telemetry |
| 3 role assignments | Function App's managed identity → storage |

No keys or connection strings for storage exist anywhere ([Spec 004 R51](../specs/004-deployment-readiness.md)).

**Cost at this scale:** a few US dollars/month or less, dominated by Log Analytics ingestion.
Flex Consumption scales to zero; the timer runs 48 short executions/day.

## 1. Prerequisites

- An Azure subscription where you can **create role assignments** (Owner, or Contributor +
  User Access Administrator). Contributor alone is not enough — the template assigns roles.
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`), signed in: `az login`
- Admin access to the GitHub repo (to set variables and environments)

Pick values and keep them handy:

```sh
SUB=<subscription-id>
RG=rg-weather-summary
LOCATION=<a region that offers Flex Consumption, e.g. eastus>
PREFIX=wxsnap            # 3–11 lowercase letters/digits
REPO=DavidHHercules/Spec-Driven-Experiment
```

## 2. Create the resource group

```sh
az account set --subscription "$SUB"
az group create --name "$RG" --location "$LOCATION"
```

## 3. Deploy the infrastructure

Edit `infra/main.bicepparam` if you want different locations or prefix, then:

```sh
az deployment group create \
  --resource-group "$RG" \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam \
  --parameters namePrefix="$PREFIX"
```

Note the outputs: `functionAppName`, `functionAppHostName`, `storageAccountName`.

```sh
APP=$(az deployment group show -g "$RG" -n main --query properties.outputs.functionAppName.value -o tsv)
```

Re-running this command is safe: Bicep deployments are declarative and idempotent.

## 4. Let GitHub Actions sign in to Azure (OIDC — no secrets)

Create an identity for the pipeline, trust GitHub's tokens for the `production` environment of
this repo only, and give it rights on this resource group only.

```sh
CLIENT_ID=$(az ad app create --display-name "github-deploy-weather-summary" --query appId -o tsv)
az ad sp create --id "$CLIENT_ID"

az ad app federated-credential create --id "$CLIENT_ID" --parameters "{
  \"name\": \"github-production\",
  \"issuer\": \"https://token.actions.githubusercontent.com\",
  \"subject\": \"repo:${REPO}:environment:production\",
  \"audiences\": [\"api://AzureADTokenExchange\"]
}"

az role assignment create \
  --assignee "$CLIENT_ID" \
  --role Contributor \
  --scope "/subscriptions/${SUB}/resourceGroups/${RG}"

TENANT_ID=$(az account show --query tenantId -o tsv)
```

*Contributor on one resource group* is a deliberate starting point, not least privilege —
see §9.

## 5. Configure GitHub

In the repo → **Settings**:

1. **Environments** → create `production`. Optionally add yourself as a required reviewer, so
   every deploy needs a click to approve.
2. **Secrets and variables → Actions → Variables** (variables, *not* secrets — none of these are secret):

   | Variable | Value |
   |----------|-------|
   | `AZURE_CLIENT_ID` | `$CLIENT_ID` |
   | `AZURE_TENANT_ID` | `$TENANT_ID` |
   | `AZURE_SUBSCRIPTION_ID` | `$SUB` |
   | `AZURE_RESOURCE_GROUP` | `$RG` |
   | `AZURE_FUNCTIONAPP_NAME` | `$APP` |

## 6. Deploy the code

**Actions → Deploy → Run workflow** (on `main`). The workflow:

1. runs the full CI checks (typecheck, tests, package check, Bicep lint) — stops if anything fails
2. builds the allowlisted package in `.deploy/`
3. signs in with OIDC and deploys it
4. smoke-tests `GET /api/weather?lat=47.6&lon=-122.3`, retrying through cold start; fails unless 200

## 7. Verify

**HTTP function**

```sh
HOST=$(az functionapp show -g "$RG" -n "$APP" --query defaultHostName -o tsv)
curl "https://${HOST}/api/weather?lat=47.6&lon=-122.3"
```

**Timer function** — wait for the next :00 or :30, or run it now via the admin endpoint:

```sh
MASTER_KEY=$(az functionapp keys list -g "$RG" -n "$APP" --query masterKey -o tsv)
curl -X POST "https://${HOST}/admin/functions/snapshots" \
  -H "x-functions-key: ${MASTER_KEY}" -H "Content-Type: application/json" -d "{}"
```

**Logs** — Application Insights → Logs:

```kusto
traces
| where timestamp > ago(1h)
| where message startswith "snapshots run:" or message startswith "weather ok"
| order by timestamp desc
```

Expect `snapshots run: saved=3 failed=0 skipped=0 …`.

**Stored data** — because shared keys are disabled, the portal's Storage browser uses *your*
Entra identity. Give yourself read access first:

```sh
ME=$(az ad signed-in-user show --query id -o tsv)
STORAGE=$(az deployment group show -g "$RG" -n main --query properties.outputs.storageAccountName.value -o tsv)
az role assignment create --assignee "$ME" --role "Storage Table Data Reader" \
  --scope "$(az storage account show -g "$RG" -n "$STORAGE" --query id -o tsv)"
```

Then portal → storage account → Storage browser → Tables → `weathersnapshots`.

## 8. Roll back

- **Code:** run the Deploy workflow again from an earlier commit. Tag the known-good commit
  (`git tag good-2026-11-08 <sha> && git push --tags`) and choose that tag in *Run workflow*.
- **Infrastructure:** check out the earlier `infra/` and re-run §3.
- **Everything:** `az group delete --name "$RG"` removes all resources. Also delete the app
  registration from §4 (`az ad app delete --id "$CLIENT_ID"`).
- **Settings only** (e.g. `SNAPSHOT_LOCATIONS`, or tuning `UPSTREAM_TIMEOUT_MS`): change in the
  portal → Function App → Environment variables. No deploy needed (Specs 002, 003).

## 9. What has NOT been verified

Verified locally (Spec 004 §5): templates compile and lint with zero warnings; no keys in repo
or compiled template; package contents; CI commands; storage-auth selection logic; Azurite path.

**Not verified — no subscription was available:**

| Item | If it fails |
|------|-------------|
| Azure accepts the Flex Consumption template as written | Fix `infra/main.bicep` from the deployment error; Bicep already validated property names against the published schema |
| The 3 role assignments are sufficient for the host with identity-based storage | Host logs show 403s on blob/queue/table → add the missing data role in `roleIds` |
| `Azure/functions-action` with `sku: flexconsumption` deploys `.deploy/` | Fall back to `az functionapp deployment source config-zip --src <zip>` and record the change |
| The deployer needs only *Contributor* on the resource group | If upload to the deployment container is denied, grant *Storage Blob Data Contributor* on the storage account |
| Least-privilege role for the deployer | Follow-up: replace Contributor with *Website Contributor* + any storage role the deploy proves to need |
| The smoke test's retry window covers a real cold start | Increase `--retry` / `--retry-delay` in `deploy.yml` |
| Role assignments propagate before the first run | Azure RBAC can take minutes; if the first snapshot run fails with 403, re-run it |

After the first real deployment, update this table: move each item to "verified" or record what changed.
