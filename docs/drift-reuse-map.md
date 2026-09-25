# Drift Reuse Map

## 1. READY TO COPY

- `apps/rate-limiter/src/index.ts` → `apps/drift-detector/src/index.ts` — Fastify bootstrap + logger. Change: port var to `DRIFT_COLLECTOR_PORT` (3003), mount drift routes.
- `apps/rate-limiter/src/middleware/auth.ts` → `apps/drift-detector/src/middleware/auth.ts` — API key auth + `resolveProject()` + Redis project cache. Change: rename Redis key prefix `rl:project:` → `drift:project:`.
- `apps/rate-limiter/src/env.ts` → `apps/drift-detector/src/env.ts` — env loader pattern. Change: swap vars to `DRIFT_*` (port, internal token, matrix TTL, max keys).
- `apps/web/app/api/rate-limiter/[projectId]/rules/route.ts` → `apps/web/app/api/drift/[projectId]/matrix/route.ts` — Next.js proxy with Clerk session + Bearer `DRIFT_INTERNAL_TOKEN`. Change: target URL + path.
- `apps/web/app/api/rate-limiter/[projectId]/events/route.ts` → `apps/web/app/api/drift/[projectId]/events/route.ts` — paginated proxy. Change: target path only.
- `apps/web/hooks/useRateLimiter.ts` → `apps/web/hooks/useDrift.ts` — SWR hook scaffold (useMatrix, useEvents, useKeys). Change: endpoints + return types.
- `apps/worker/src/processors/rate-limit-event.processor.ts` → `apps/drift-detector/src/workers/diffWorker.ts` — BullMQ worker shell (queue init, concurrency, error swallow). Change: replace body with diff logic.

## 2. READY TO EXTEND

- `packages/db/prisma/schema.prisma` — add `DriftEnvironment`, `DriftManifest`, `DriftEvent`, `DriftKeyMeta` models + `DriftEventType` enum + 4 relation lines on `Project`. ~55 lines.
- `packages/queue/` (existing index/exports) — add `driftQueue` (queue name `drift-diff`) export + `DriftJobData` type. ~15 lines.
- `apps/web/components/Sidebar` (wherever Rate Limiter nav item lives) — add Drift nav entry pointing to `/dashboard/[projectId]/drift/overview`. ~5 lines.
- `apps/worker/src/lib/alert-evaluator.ts` — add `evaluateDriftAlert()` triggered after diff worker finishes (optional in D-3). ~30 lines.
- `.env.example` / `apps/drift-detector/.env` — add the 6 new `DRIFT_*` / `RUNIC_DRIFT_*` vars. ~8 lines.

## 3. READY TO IMPORT

- `packages/db` — `prisma` singleton client (zero changes).
- `packages/queue` — existing Redis connection export (reuse for BullMQ + matrix cache).
- `apps/worker/src/lib/notifications.ts` — `dispatch()` for email + Slack alert delivery.
- Debounce pattern `alert:debounce:${alertId}` from `apps/worker/src/lib/alert-evaluator.ts` — reuse Redis SETNX + TTL idiom for drift alert debounce.
- `User.plan` field on `User` model — gate max envs / history / CI per plan limits table.
- Clerk session middleware in `apps/web` — wraps all `/api/drift/*` proxy routes unchanged.
- `RATE_LIMITER_INTERNAL_TOKEN` Bearer-forwarding pattern — apply verbatim with `DRIFT_INTERNAL_TOKEN`.
- SHA-256 hashing helper from `apps/rate-limiter/src/middleware/auth.ts` — reuse for API key lookup in drift-detector.

## 4. BUILD FROM SCRATCH

- `packages/sdk-drift/` — agent runtime: `Object.keys(process.env)` extractor, ignored-keys filter, regex validator, HTTPS POST to `/v1/snapshot`. No equivalent exists.
- `packages/sdk-drift/bin/runic-drift.ts` — `commander`/`yargs` CLI with `snapshot | watch | ci-check` subcommands. No CLI tooling in repo.
- Diff worker domain logic — baseline-vs-current set diff, KEY_RESTORED resolution, STALE_ROTATION clock check, DriftScore formula, idempotent open-event guard. Logic is novel.
- Matrix RSC page (`apps/web/app/dashboard/[projectId]/drift/matrix/page.tsx`) — sticky row+col headers, cell drawer, CSV export. No comparable matrix UI in repo.
- CTE-based matrix SQL query (<500ms for 10 envs × 200 keys). No multi-env pivot exists.
- `/v1/ci-check` always-200 contract + GitHub Action manifest. No CI integration today.

## 5. IMPLEMENTATION ORDER (D-1 + D-2)

### D-1

1. **Add Prisma models.** Edit `packages/db/prisma/schema.prisma` (add 4 models + enum + 4 Project relations). Run `npx prisma generate && npx prisma migrate dev --name add_drift`. Files: 1.
2. **Add drift queue.** Edit `packages/queue/src/index.ts` (or existing queue export file) to add `driftQueue` + `DriftJobData` type. Reuse existing Redis connection import. Files: 1.
3. **Scaffold collector service.** Copy `apps/rate-limiter/src/index.ts` → `apps/drift-detector/src/index.ts`; copy `apps/rate-limiter/src/env.ts` → `apps/drift-detector/src/env.ts`; copy `apps/rate-limiter/src/middleware/auth.ts` → `apps/drift-detector/src/middleware/auth.ts`. Swap port + env vars. Files: 3.
4. **Implement `POST /v1/snapshot`.** Create `apps/drift-detector/src/routes/snapshot.ts` — validate `keys[]` (count>0, no `=`), trim+uppercase, upsert `DriftEnvironment`, insert `DriftManifest`, enqueue to `driftQueue`, return `{received, driftJobId}` 202. Mount in `index.ts`. Files: 2.
5. **Diff worker (missing/extra only).** Create `apps/drift-detector/src/workers/diffWorker.ts` — load baseline + previous manifest, set diff, write/resolve `DriftEvent`, compute DriftScore (skip stale for D-1), update `DriftEnvironment.driftScore + lastSeenAt`. Files: 1.
6. **SDK core.** Create `packages/sdk-drift/src/index.ts` + `packages/sdk-drift/src/extract.ts` — env key extraction (filter ignored list, regex validate) + HTTPS client posting names only. Files: 2.
7. **CLI snapshot command.** Create `packages/sdk-drift/bin/runic-drift.ts` wiring `commander` with `snapshot --env --project-key [--dotenv]` calling SDK. Add bin entry in `packages/sdk-drift/package.json`. Files: 2.

### D-2

8. **Matrix route + cache.** Create `apps/drift-detector/src/routes/matrix.ts` — single CTE query, Redis cache key `matrix:{projectId}` TTL 30s. Add cache invalidation call in `snapshot.ts` and `diffWorker.ts`. Files: 3.
9. **Matrix proxy + hook.** Create `apps/web/app/api/drift/[projectId]/matrix/route.ts` (copy from rate-limiter proxy). Create `apps/web/hooks/useDrift.ts` with `useMatrix()`. Files: 2.
10. **Matrix RSC page.** Create `apps/web/app/dashboard/[projectId]/drift/matrix/page.tsx` — server-rendered grid, sticky headers, filter bar, cell drawer stub, CSV export. Files: 1.
11. **Events route + page.** Create `apps/drift-detector/src/routes/events.ts` (paginated query) and `apps/web/app/dashboard/[projectId]/drift/events/page.tsx` + proxy `apps/web/app/api/drift/[projectId]/events/route.ts`. Files: 3.
12. **Overview page.** Create `apps/web/app/dashboard/[projectId]/drift/overview/page.tsx` — DriftScore cards (reads from `DriftEnvironment` via matrix endpoint) + recent events list (reuses events hook). Files: 1.
13. **Environments route + page.** Create `apps/drift-detector/src/routes/environments.ts` (list/add/setBaseline/delete; setBaseline re-enqueues diff for all envs) and `apps/web/app/dashboard/[projectId]/drift/environments/page.tsx` + proxy. Files: 3.
14. **Sidebar nav.** Edit the existing sidebar component to add Drift entry pointing to `/dashboard/[projectId]/drift/overview`. Files: 1.
