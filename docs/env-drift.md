# Runic Drift — Env & Secret Drift Detector
> Feature addition to Runic Observe monorepo. Slot into existing infra — do not scaffold new monorepo, auth, or queue systems.

---

## Hard Rules (never violate)
- Never store secret values — key names only, always
- Agent never throws, never blocks startup > 500ms, exits 0 on any error
- All agent→API over HTTPS only
- Deterministic diffs — same two manifests always produce same result
- Ignoring a key resolves its existing DriftEvents immediately, not just future ones
- Use existing Runic API key auth for agent endpoints, existing Clerk session for dashboard

---

## Where Things Go

| New item | Location |
|---|---|
| Fastify collector service | `apps/drift-detector/` |
| BullMQ diff worker | `apps/drift-detector/src/workers/diffWorker.ts` |
| Agent / CLI SDK | `packages/sdk-drift/` |
| Prisma models | ADD to `packages/db/prisma/schema.prisma` |
| BullMQ queue | ADD to existing `packages/queue/` |
| Dashboard routes | ADD to `apps/web/app/dashboard/[projectId]/drift/` |
| Next.js API proxies | ADD to `apps/web/app/api/drift/` |

---

## New Prisma Models (add to existing schema)

**DriftEnvironment** — `id, projectId→Project, name, isBaseline, driftScore(0-100), lastSeenAt, createdAt` | unique `[projectId, name]`

**DriftManifest** — `id, environmentId→DriftEnvironment, projectId, keys String[], agentVersion?, agentId?, capturedAt` | index `[environmentId, capturedAt]`

**DriftEvent** — `id, projectId, environmentId→DriftEnvironment, keyName, driftType(enum), detectedAt, resolvedAt?, resolved` | index `[projectId, detectedAt]`

**DriftKeyMeta** — `id, projectId, environmentId?(null=all envs), keyName, description?, owner?, rotationDays?, firstSeenAt, lastChangedAt?, isIgnored, ignoreReason?` | unique `[projectId, keyName, environmentId]`

**DriftEventType enum** — `MISSING_KEY | EXTRA_KEY | STALE_ROTATION | KEY_RESTORED`

After adding: `cd packages/db && npx prisma generate && npx prisma migrate dev --name add_drift`

---

## API Routes — apps/drift-detector (port 3003)

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/v1/snapshot` | API key | Receive manifest → store → enqueue diff. Reject if keys=0 or contains `=`. Sanitize: trim + uppercase. Response 202: `{received, driftJobId}` |
| GET | `/v1/matrix/:projectId` | Session | Comparison matrix. Redis cache 30s key `matrix:{projectId}`. Invalidate on new manifest. <500ms for 10envs×200keys — use CTE |
| GET | `/v1/events/:projectId` | Session | Paginated DriftEvent[]. Default: resolved=false, limit=50, desc |
| GET | `/v1/keys/:projectId` | Session | DriftKeyMeta[] + drift status + daysOverdue |
| PATCH | `/v1/keys/:projectId/:keyName` | Session | Update metadata. isIgnored=true → resolve all open DriftEvents for that key immediately |
| POST | `/v1/baseline/:projectId` | Session | Set baseline env → re-enqueue diff for all other envs |
| GET | `/v1/ci-check/:projectId` | API key | `{passed, missingKeys, extraKeys, driftScore}`. Always HTTP 200 — never 4xx on drift |

---

## Diff Worker Logic (in order)

1. Load new manifest + baseline latest manifest + this env's previous manifest
2. `missingKeys` = baseline.keys − env.keys | `extraKeys` = env.keys − baseline.keys
3. Skip ignored keys (DriftKeyMeta.isIgnored)
4. Create DriftEvents for new drift | resolve existing for fixed keys (KEY_RESTORED)
5. Check rotationDays → if `now − lastChangedAt > rotationDays` → STALE_ROTATION event
6. DriftScore = `clamp(100 − (missing×10) − (extra×5) − (stale×15), 0, 100)`
7. Invalidate Redis matrix cache | fire alerts via existing alert pipeline

**Idempotent** — check for existing open event before creating. Same input = same output always.

---

## Agent SDK — packages/sdk-drift

**Always ignore:** `PATH HOME USER SHELL TERM PWD _ SHLVL OLDPWD LOGNAME TMPDIR EDITOR VISUAL PAGER LANG LC_ALL LC_CTYPE COLORTERM TERM_PROGRAM SSH_AUTH_SOCK XPC_FLAGS XPC_SERVICE_NAME`

**Key extraction:** `Object.keys(env)` → filter ignored → trim → uppercase → validate `/^[A-Z][A-Z0-9_]*$/` → POST names only, never values

**CLI commands:**
```
runic-drift snapshot --env production --project-key pk_live_xxx
runic-drift snapshot --env staging --dotenv .env.staging --project-key pk_live_xxx
runic-drift watch --env staging --interval 15 --project-key pk_live_xxx
runic-drift ci-check --env staging --fail-on-drift --ignore-keys DATABASE_URL,NODE_ENV --project-key pk_live_xxx
```

Use `commander` or `yargs`. Add `--json` flag for CI log parsing.

---

## Dashboard Routes (add to apps/web)

```
/dashboard/[projectId]/drift/
  overview/     → DriftScore cards + recent events
  matrix/       → HERO: rows=keys, cols=envs, cells=present/missing/extra/stale/ignored
  events/       → feed with filters (env, type, resolved)
  keys/         → metadata editor (description, owner, rotationDays, isIgnored)
  environments/ → add/set baseline/delete envs
  settings/     → agent setup + CI snippets
```

**Matrix:** Server-rendered RSC. Sticky row+col headers. Click cell → drawer. Filter bar. Export CSV.
Colors: present=green, missing=red, stale=amber, extra=blue, ignored=grey.

---

## Reuse from Existing Codebase

| What to reuse | Where it is now |
|---|---|
| Fastify bootstrap + logger | `apps/rate-limiter/src/index.ts` — copy structure |
| API key auth + `resolveProject()` | `apps/rate-limiter/src/middleware/auth.ts` — copy |
| Internal token auth pattern | Same as `RATE_LIMITER_INTERNAL_TOKEN` middleware |
| Redis connection | Existing export in `packages/queue` |
| Alert dispatch — email + Slack | Existing `dispatch()` in worker notifications |
| Debounce Redis pattern | `alert:debounce:${alertId}` in `alert-evaluator.ts` |
| Next.js proxy route structure | Any `apps/web/app/api/rate-limiter/` file — copy |
| Dashboard hook pattern | `useRateLimiter.ts` → copy as `useDrift.ts` |
| Sidebar nav item | Where Rate Limiter nav item was added |
| Plan limit check | Existing `user.plan` field on User model |

---

## New Env Vars

```bash
DRIFT_COLLECTOR_PORT=3003
DRIFT_REDIS_KEY_MATRIX_TTL=30
DRIFT_MAX_KEYS_PER_SNAPSHOT=500
DRIFT_INTERNAL_TOKEN=
RUNIC_DRIFT_API_URL=https://drift.runicobserve.com
RUNIC_DRIFT_ENV=production
```

---

## Build Order

**D-1:** Prisma models + migrate → drift queue → `apps/drift-detector` scaffold → `POST /v1/snapshot` → diff worker (missing/extra only, no stale yet) → `packages/sdk-drift` → `runic-drift snapshot` CLI

**D-1:** ✅ Complete — apps/drift-detector (port 3003), packages/sdk-drift, migration add_drift applied

**D-2:** ✅ Complete — matrix route, events/overview/environments/matrix pages, sidebar nav, Next.js proxy routes

**D-3:** keys routes → key metadata editor page → stale rotation in worker → alert integration → DriftScore on overview

**D-3:** ✅ Complete — keys routes, PATCH metadata, stale rotation in worker, alert integration, keys editor page, DriftScore display

**D-4:** `GET /v1/ci-check` → `runic-drift ci-check` CLI → GitHub Action → settings page with CI snippets

**D-4:** ✅ Complete — ci-check route, runic-drift ci-check CLI, GitHub Action stub, settings page with CI snippets

---

## Plan Limits

| Plan | Max envs | History | CI | Annotations |
|---|---|---|---|---|
| Free | 2 | 24h | No | No |
| Starter | 5 | 7d | Yes | Basic |
| Pro | ∞ | 30d | Yes | Full |
| Enterprise | ∞ | Custom | Yes | Full+RBAC |

Stripe meter: `drift_snapshots_monthly` — 1 event per successful `POST /v1/snapshot`.

---

## GitHub Action — CI Integration Guide

The `drift-action/` directory contains a self-contained GitHub Action that runs `runic-drift ci-check` inside any GitHub Actions workflow. It is bundled with `ncc` into a single `dist/index.js` — no `node_modules` required at runner runtime.

---

### How the action works (internal wiring)

| action.yml input | CLI flag passed to `runic-drift ci-check` |
|---|---|
| `project-key` | `--project-key <value>` |
| `environment` | `--env <value>` |
| `fail-on-drift` | enables `core.setFailed()` when `result.passed === false` |
| `ignore-keys` | `--ignore-keys <value>` (omitted when empty) |
| `api-url` | `--api-url <value>` (omitted when empty, CLI default applies) |

The action always adds `--json` so it can parse `{ passed, driftScore, missingKeys, extraKeys }` from stdout. All three outputs (`drift-score`, `missing-keys`, `extra-keys`) are set from the parsed JSON before any failure is raised, so downstream steps can always read them.

The action makes the same HTTP call that `runic-drift ci-check --json` makes internally, replicated directly in the ncc bundle. No subprocess, no installed binary, no `npm ci` pre-step required — the `dist/index.js` is completely self-contained.

---

### Prerequisites

1. **Runic API key** — generate one in the Runic dashboard under *Settings → API Keys*. Store it as a GitHub Actions secret (e.g. `RUNIC_API_KEY`).
2. **Baseline environment set** — the drift check compares against whatever environment is marked as baseline in the Runic dashboard. Set it once via *Drift → Environments → Set as baseline* or `POST /v1/baseline/:projectId`.
3. **Snapshot already sent** — at least one `runic-drift snapshot` run must exist for the environment being checked, otherwise the check returns "no baseline set" and passes by default.

---

### Minimal workflow — check on every push

```yaml
# .github/workflows/drift-check.yml
name: Env Drift Check

on:
  push:
    branches: [main, staging]
  pull_request:

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Runic Drift Check
        uses: ./drift-action          # local action — no version tag needed in monorepo
        with:
          project-key: ${{ secrets.RUNIC_API_KEY }}
          environment: staging        # must match the env name used in snapshot
          fail-on-drift: 'true'       # fails the job when drift is detected
          ignore-keys: 'NODE_ENV,CI'  # optional: comma-separated keys to exclude
```

---

### Full workflow — snapshot on deploy, check on PR

```yaml
# .github/workflows/drift-full.yml
name: Drift Pipeline

on:
  push:
    branches: [main]          # snapshot after every production deploy
  pull_request:               # ci-check on every PR

jobs:
  # ── Snapshot (runs only on merge to main) ─────────────────────────────────
  snapshot:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      # Send the current env key names to the Runic drift collector
      - run: |
          npx runic-drift snapshot \
            --env production \
            --project-key ${{ secrets.RUNIC_API_KEY }}

  # ── CI Check (runs on every PR) ────────────────────────────────────────────
  drift-check:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Runic Drift Check
        id: drift
        uses: ./drift-action
        with:
          project-key: ${{ secrets.RUNIC_API_KEY }}
          environment: staging
          fail-on-drift: 'true'
          ignore-keys: 'NODE_ENV,CI,GITHUB_TOKEN'

      # Consume outputs in a downstream step (even when the action fails,
      # the outputs are set before core.setFailed() is called)
      - name: Print drift summary
        if: always()
        run: |
          echo "Drift score : ${{ steps.drift.outputs.drift-score }}/100"
          echo "Missing keys: ${{ steps.drift.outputs.missing-keys }}"
          echo "Extra keys  : ${{ steps.drift.outputs.extra-keys }}"
```

---

### Action outputs reference

| Output | Type | Example |
|---|---|---|
| `drift-score` | string (0–100) | `"85"` |
| `missing-keys` | comma-separated string | `"DB_PASSWORD,REDIS_URL"` |
| `extra-keys` | comma-separated string | `"OLD_SECRET"` |

Use `steps.<id>.outputs.drift-score` to gate other jobs, post comments, or send Slack alerts.

---

### Rebuilding the action after changes

Any change to `drift-action/src/index.ts` requires a rebuild before the action works:

```bash
cd drift-action
./node_modules/.bin/ncc build src/index.ts -o dist --license licenses.txt
# or: npm run build
git add dist/index.js dist/licenses.txt
git commit -m "chore: rebuild drift-action bundle"
```

The `dist/index.js` must be committed — GitHub Actions loads it directly from the repo, not from a registry.

---

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Action step fails with network error | Runner can't reach `drift.runicobserve.com` | Check firewall/proxy settings; the action calls the API directly over HTTPS |
| `no baseline set` in output | No environment has been marked as baseline | Set baseline in dashboard or via `POST /v1/baseline/:projectId` |
| Score 100, no drift, but keys changed | Snapshot not sent after deploy | Add the snapshot job (see full workflow above) |
| Action exits 0 even with `fail-on-drift: 'true'` | Drift check API was unreachable (fail-open design) | Check `RUNIC_DRIFT_API_URL` and network connectivity from the runner |

---

## Known Issues

All resolved as of 2026-05-28.

| # | Where | Symptom | Root cause | Status |
|---|---|---|---|---|
| 1 | `apps/web/app/dashboard/errors/page.tsx` — `handleResolve` / `handleUnresolve` | "Mark as resolved" button did nothing | `res.ok` guard was already present; actual failure was the proxy route (see #3) forwarding a PATCH with `Content-Type: application/json` but no body, causing Fastify to return 400 | ✅ Resolved |
| 2 | `apps/web/app/dashboard/alerts/page.tsx` — `handleTest` | "Send test" button returned HTTP 400 | `fetch` posted with no `body` and no `Content-Type`; server rejected the empty request | ✅ Resolved — added `Content-Type: application/json` + `body: JSON.stringify({ type, channel, destination })` |
| 3 | `apps/web/app/api/projects/[id]/errors/[errorId]/resolve/route.ts` | PATCH proxy triggered `FST_ERR_CTP_EMPTY_JSON_BODY` in Fastify | `proxyToApi` always sends `Content-Type: application/json` but no body was passed, so Fastify received the header with an empty body | ✅ Resolved — added `body: JSON.stringify({})` to the `proxyToApi` call |
| 4 | `apps/web/app/api/projects/[id]/alerts/[alertId]/test/route.ts` | Test-alert POST proxy returned 400 from Fastify | Same as #3 — `Content-Type: application/json` forwarded with no body; incoming `type / channel / destination` were never read from the request | ✅ Resolved — route now reads and forwards `{ type, channel, destination }` as JSON body |
| 5 | `apps/web/app/dashboard/alerts/page.tsx` — `handleTest` | Stale debug `console.log` claimed "payload: none (no body sent)" after fix #2 was applied | Log was added during diagnosis and not removed when the fix landed | ✅ Resolved — log removed |