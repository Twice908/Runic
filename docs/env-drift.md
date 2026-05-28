# Pulse Drift — Env & Secret Drift Detector
> Feature addition to Pulse Observe monorepo. Slot into existing infra — do not scaffold new monorepo, auth, or queue systems.

---

## Hard Rules (never violate)
- Never store secret values — key names only, always
- Agent never throws, never blocks startup > 500ms, exits 0 on any error
- All agent→API over HTTPS only
- Deterministic diffs — same two manifests always produce same result
- Ignoring a key resolves its existing DriftEvents immediately, not just future ones
- Use existing Pulse API key auth for agent endpoints, existing Clerk session for dashboard

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
pulse-drift snapshot --env production --project-key pk_live_xxx
pulse-drift snapshot --env staging --dotenv .env.staging --project-key pk_live_xxx
pulse-drift watch --env staging --interval 15 --project-key pk_live_xxx
pulse-drift ci-check --env staging --fail-on-drift --ignore-keys DATABASE_URL,NODE_ENV --project-key pk_live_xxx
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
PULSE_DRIFT_API_URL=https://drift.pulseobserve.com
PULSE_DRIFT_ENV=production
```

---

## Build Order

**D-1:** Prisma models + migrate → drift queue → `apps/drift-detector` scaffold → `POST /v1/snapshot` → diff worker (missing/extra only, no stale yet) → `packages/sdk-drift` → `pulse-drift snapshot` CLI

**D-1:** ✅ Complete — apps/drift-detector (port 3003), packages/sdk-drift, migration add_drift applied

**D-2:** ✅ Complete — matrix route, events/overview/environments/matrix pages, sidebar nav, Next.js proxy routes

**D-3:** keys routes → key metadata editor page → stale rotation in worker → alert integration → DriftScore on overview

**D-3:** ✅ Complete — keys routes, PATCH metadata, stale rotation in worker, alert integration, keys editor page, DriftScore display

**D-4:** `GET /v1/ci-check` → `pulse-drift ci-check` CLI → GitHub Action → settings page with CI snippets

**D-4:** ✅ Complete — ci-check route, pulse-drift ci-check CLI, GitHub Action stub, settings page with CI snippets

---

## Plan Limits

| Plan | Max envs | History | CI | Annotations |
|---|---|---|---|---|
| Free | 2 | 24h | No | No |
| Starter | 5 | 7d | Yes | Basic |
| Pro | ∞ | 30d | Yes | Full |
| Enterprise | ∞ | Custom | Yes | Full+RBAC |

Stripe meter: `drift_snapshots_monthly` — 1 event per successful `POST /v1/snapshot`.