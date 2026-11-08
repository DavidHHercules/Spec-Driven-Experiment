# Tasks 004: Deployment Readiness

- **Implements:** [Spec 004](004-deployment-readiness.md) via [Plan 004](004-deployment-readiness.plan.md)
- **Created:** 2026-11-08

Same rules: in order, one task = one commit, tests first where there is code.

## Progress

| Task | Title | Requirements | Status |
|------|-------|--------------|--------|
| T31 | Storage target selection + identity path | R54, R55 | ☑ |
| T32 | Bicep infrastructure | R49–R53, R56 | ☑ |
| T33 | Deployment package script + check | R61 | ☑ |
| T34 | CI workflow | R58, N11, N12 | ☐ |
| T35 | Deploy workflow | R59 | ☐ |
| T36 | Runbook | R60, N13 | ☐ |
| T37 | Verification sweep | §5 | ☐ |
| T38 | Acceptance review | §8 | ☐ |

---

## T31 — Storage target selection + identity path

**Tests first** (`tableSnapshotStore.test.ts`):
- [x] R54.1: connection string set → `connection-string` (Azurite and real formats).
- [x] R54.1: connection string set **and** account name set → connection string wins.
- [x] R54.2: only `AzureWebJobsStorage__accountName` → `identity` with `https://{account}.table.core.windows.net`.
- [x] R54.2: empty / whitespace connection string is treated as unset.
- [x] R54.3: neither → `none`; the store's `upsert` rejects naming both settings.
- [x] R55: the snapshots adapter uses `createSnapshotStoreFromSettings(process.env)`.

## T32 — Bicep infrastructure

**Done when**
- [x] `infra/main.bicep` and `infra/main.bicepparam` per plan §3.
- [x] `bicep build` and `bicep lint`: zero errors, zero warnings.
- [x] Compiled template has exactly the R56 app settings, `allowSharedKeyAccess: false`, 3 role assignments.

## T33 — Deployment package script + check

**Done when**
- [x] `npm run package:check` passes.
- [x] Deliberately placing a forbidden file in `.deploy/` makes the check fail (then removed).
- [x] `.deploy/` git- and func-ignored.

## T34 — CI workflow

**Done when**
- [ ] `.github/workflows/ci.yml` per plan §5; parses as YAML; triggers `push`, `pull_request`, `workflow_call`.
- [ ] Its npm steps pass locally on Node 22.

## T35 — Deploy workflow

**Done when**
- [ ] `.github/workflows/deploy.yml` per plan §5; parses as YAML; only `workflow_dispatch`.
- [ ] Reviewed against every R59 bullet; no secrets referenced (only `vars.*`).

## T36 — Runbook

**Done when**
- [ ] `docs/deploy.md` covers every R60 item and lists plan §7 as unverified.
- [ ] README links to it.

## T37 — Verification sweep

- [ ] R51 search: no keys or connection strings in repo or compiled template.
- [ ] Azurite + `func start`: snapshots still stored (R55).
- [ ] Full test suite passes; existing tests unchanged.

## T38 — Acceptance review

- [ ] Spec §8 ticked; statuses updated; README → Done.
