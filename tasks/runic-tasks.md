# Runic — Task Tracker

> Claude updates this file at the end of every session. Check here before starting work to know exactly where things stand.

---

## ✅ Phase 0 — Planning (COMPLETE)

- [x] Architecture defined
- [x] Tech stack chosen and documented in `CLAUDE.project.md`
- [x] All Prisma data models designed
- [x] Monetization tiers defined

---

## ✅ Phase 1a — Monorepo Boilerplate (COMPLETE)

All packages compile with zero TypeScript errors.

---

## ✅ Phase 1b — Ingestion Core (COMPLETE)

- [x] `docker-compose.yml` — TimescaleDB + Redis
- [x] API key generation + SHA-256 hashing (`src/lib/api-key.ts`)
- [x] `POST /projects` — creates project, returns raw key once
- [x] `POST /ingest` — hash lookup → plan limit check → BullMQ `addBulk`
- [x] Worker `ingest.processor.ts` — writes `RequestLog`, upserts `ErrorEvent`
- [x] Rate limiting — per-API-key (Redis-backed, 100 req/10s)
- [x] `RequestLog` composite PK `@@id([id, timestamp])` for TimescaleDB compatibility

### Manual DB steps (run once after Docker is up)
```bash
docker compose up -d
cd packages/db
npx prisma migrate dev --name init
npx prisma db execute --file ./prisma/timescale-setup.sql --schema ./prisma/schema.prisma
```

---

## ✅ Phase 2 — Dashboard Foundation (COMPLETE)

### Backend (apps/api)
- [x] `POST /webhooks/clerk` — svix signature verification, upserts User on `user.created`
  - Raw body captured via `preParsing` hook (no extra package needed)
  - Rate limiter bypassed via `{ config: { rateLimit: false } }`
- [x] `POST /projects` — real Clerk JWT verification via `verifyToken` from `@clerk/backend`
  - Looks up User in DB by clerkId — returns 401 if not found
- [x] `apps/api/src/env.ts` — added `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`

### Next.js API routes (apps/web/app/api/)
- [x] `GET /api/projects` — lists all projects for authenticated user (via Prisma)
- [x] `POST /api/projects` — proxies to Fastify API with Clerk JWT, returns raw key once
- [x] `GET /api/projects/[id]/logs` — paginated logs with statusCategory + since filters
- [x] `GET /api/projects/[id]/stats` — totalRequests, requestsLast24h, errorRate, avgResponseTime, activeErrors

### Dashboard UI (apps/web)
- [x] `app/dashboard/layout.tsx` — Server Component: auth check + project list → passes to Sidebar
- [x] `components/Sidebar.tsx` — dark sidebar (#0f1117), project selector, nav (Overview, Live Logs, Errors), UserButton
- [x] `app/dashboard/page.tsx` — empty state with "Create project" or stats + log table
- [x] `components/CreateProjectModal.tsx` — two-step: create form → one-time API key reveal with copy button
- [x] `components/StatsCards.tsx` — 4 metric cards, skeleton loaders, color-coded thresholds
- [x] `components/LogTable.tsx` — paginated, status filter (All/2xx/3xx/4xx/5xx), method + status badges
- [x] `app/dashboard/logs/page.tsx` — live feed using `useLiveLogs` hook, pulsing "Live" indicator
- [x] `hooks/useLiveLogs.ts` — polls every 3s, stops on hidden tab, prepends new rows, flash animation
- [x] `lib/utils.ts` — `relativeTime`, `formatResponseTime`, `statusCategory`
- [x] `lib/api.ts` — typed `apiFetch<T>` wrapper with error parsing
- [x] `app/globals.css` + `tailwind.config.ts` — `animate-flash-new` keyframe for new log rows
- [x] `next.config.js` — loads root `.env` via dotenv so API routes access `DATABASE_URL`

### packages/types additions
- [x] `RequestLogRow`, `ProjectSummary`, `ProjectStats`, `LogsResponse`, `CreateProjectResponse`

### Before Phase 2 works end-to-end
1. Add `CLERK_WEBHOOK_SECRET` to root `.env` (get from Clerk dashboard → Webhooks)
2. Register the Clerk webhook URL: `https://<your-domain>/webhooks/clerk`
3. Events to subscribe: `user.created`
4. DB + migration must be running (see Phase 1b steps above)

---

## 🐛 Bug Fix — Project Creation 401 "User not found" (FIXED)

**Symptom**: `POST http://localhost:3000/api/projects` returned 401 with `{ error: { code: "USER_NOT_FOUND", message: "User not found. Please sign in again." } }`. Re-signing in did not help.

**Root cause**: User records are inserted into the `User` table by the Clerk `user.created` webhook (`POST /webhooks/clerk`). In local development, Clerk's servers cannot reach `localhost:3001`, so the webhook never fires and the `User` row is never created. The Fastify project-creation route does a `prisma.user.findUnique({ where: { clerkId } })` and returns 401 when no row is found — regardless of whether the JWT is valid.

**Fix**: Added auto-upsert in `apps/web/app/dashboard/layout.tsx` (a Server Component that runs on every dashboard page load):
- After the initial `findUnique`, if `user` is null, calls `currentUser()` from `@clerk/nextjs/server` to get the user's email from the live Clerk session.
- Runs `prisma.user.upsert(...)` to create the row.
- This is idempotent: once the row exists (e.g., because the webhook fired in staging/production), the upsert becomes a no-op and adds no visible latency.
- No code changes needed in the Fastify API — the row will exist by the time any Fastify route checks for it.

---

## 🐛 Bug Fix — Project Creation 500 Error (FIXED)

**Symptom**: `POST http://localhost:3000/api/projects` returned 500; browser console showed `apiFetch @ api.ts:2` / `handleSubmit @ CreateProjectModal.tsx:32`.

**Root cause (3 compounding issues)**:

1. **`CLERK_WEBHOOK_SECRET` missing from root `.env`**
   - `apps/api/src/env-loader.ts` loads only the root `.env`.
   - `apps/api/src/env.ts` has `CLERK_WEBHOOK_SECRET: z.string().min(1)` — a **required** field.
   - Missing env var → Zod throws `ZodError` at Fastify startup → **API server never starts**.
   - The real secret was in `apps/web/.env` but never copied to the root `.env`.

2. **`CLERK_SECRET_KEY` in root `.env` was a placeholder**
   - Even if Fastify had started, `verifyToken(jwt, { secretKey: 'sk_test_placeholder' })` would fail every JWT verification and return 401 for all authenticated routes.

3. **No error handling around `fetch` in Next.js proxy routes**
   - When Fastify is unreachable (ECONNREFUSED), `fetch` throws an uncaught `TypeError`.
   - Uncaught exception in a Next.js route handler → generic 500 with no useful message.

**Fix**:
- Copied real `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, and `CLERK_WEBHOOK_SECRET` from `apps/web/.env` into the root `.env`.
- Created `apps/web/lib/api-proxy.ts` — shared `proxyToApi()` helper that wraps `fetch` in a try-catch and returns a clear `503` when the API server is unreachable.
- Refactored all 6 Next.js proxy routes (projects POST, reveal-key, and 4 analytics routes) to use `proxyToApi()`.

---

## ✅ Pre-Phase 3 Fixes (COMPLETE)

- [x] **Fix 1 — Clerk Auth 404**: Converted `(auth)/sign-in/page.tsx` → `(auth)/sign-in/[[...sign-in]]/page.tsx` and same for sign-up; added Clerk redirect URL vars to `apps/web/.env`
- [x] **Fix 2 — API Key Reveal**: Added `POST /projects/:projectId/reveal-key` to Fastify; Next.js proxy at `app/api/projects/[id]/reveal-key/route.ts`; `RegenerateKeyModal.tsx` with confirmation + DEV warning banner; "Regenerate & Show API Key" button on dashboard; DEV warning added to `CreateProjectModal.tsx`

---

## ✅ Phase 3 — Analytics & Metrics (COMPLETE)

- [x] TimescaleDB continuous aggregates: `request_stats_hourly` + `request_stats_daily` (count, error_count, avg, sum, min, max per project/route/method/bucket)
- [x] Fastify analytics routes: `/projects/:id/analytics/{volume,latency,top-routes,errors}` (Clerk JWT auth, ownership check, parameterized queries)
- [x] `packages/types` additions: `VolumeBucket`, `LatencyBucket`, `TopRoute`, `ErrorGroup`
- [x] Next.js API proxy routes for all 4 analytics endpoints
- [x] `TimeRangeSelector` component (pill toggle, range persisted in URL `?range=`)
- [x] `hooks/useAnalytics.ts` — 4 typed hooks, 60s auto-refresh, pauses on hidden tab
- [x] `VolumeChart` — AreaChart with dual areas (requests blue, errors red), loading skeleton, empty state
- [x] `LatencyChart` — LineChart with P50/P90/P99 lines, y-axis in ms
- [x] `ErrorRateChart` — AreaChart with green→red gradient fill, y-axis 0–100%
- [x] `TopRoutesTable` — sortable, color-coded error rate and latency thresholds
- [x] `app/dashboard/analytics/page.tsx` — full layout (volume row, latency+error row, top routes)
- [x] `app/dashboard/errors/page.tsx` — error group cards, expandable stack trace, empty state
- [x] "Analytics" added to Sidebar nav
- [x] Zero TypeScript errors across all packages

### Notes
- `percentile_cont` unsupported in TimescaleDB continuous aggregates on standard image (non-HA). P50/P90/P99 computed from raw hypertable data; composite index `("projectId", timestamp DESC)` added to keep queries fast.
- `ErrorRateChart` reuses volume data — no extra API call needed.
- Run `npx prisma db execute --file ./prisma/timescale-setup.sql` to apply aggregates after DB is up.

---

## ✅ Phase 4 — Alerting & Uptime (COMPLETE)

- [x] Schema migration: `AlertEvent` table + `url`/`route` fields added to `Alert` (`phase4-alerting`)
- [x] `AlertType` renamed from `latency` → `response_time` in `packages/types`
- [x] `packages/types` additions: `AlertRule`, `AlertHistoryEntry`, `UptimeStatus`, `UptimeCheck`
- [x] `apps/worker/src/lib/redis.ts` — shared IORedis client for worker
- [x] `apps/worker/src/lib/notifications.ts` — Resend email + Slack Block Kit dispatcher; logs errors, never crashes
- [x] `apps/worker/src/lib/alert-evaluator.ts` — evaluates `uptime`, `error_rate`, `response_time` alerts; Redis debounce (5 min TTL on `alert:debounce:{alertId}`)
- [x] `apps/worker/src/processors/uptime.processor.ts` — HTTP ping with 10s timeout, writes `UptimeCheck`, calls `evaluateAlerts`
- [x] `apps/worker/src/index.ts` — BullMQ repeatable job `uptime-check` every 60s; removes stale jobs on restart
- [x] `apps/worker/src/processors/ingest.processor.ts` — calls `evaluateAlerts` fire-and-forget after each batch
- [x] `apps/api/src/routes/alerts.ts` — 5 routes: GET/POST alerts, PATCH/DELETE alert, GET history, GET uptime
- [x] `apps/web/app/api/projects/[id]/alerts/route.ts` — GET + POST proxy
- [x] `apps/web/app/api/projects/[id]/alerts/[alertId]/route.ts` — PATCH + DELETE proxy
- [x] `apps/web/app/api/projects/[id]/alerts/history/route.ts` — GET proxy
- [x] `apps/web/app/api/projects/[id]/uptime/route.ts` — GET proxy
- [x] `apps/web/hooks/useAlerts.ts` — `useAlerts` + `useAlertHistory` hooks
- [x] `apps/web/hooks/useUptime.ts` — `useUptime` hook with 60s polling
- [x] `apps/web/app/dashboard/alerts/page.tsx` — alert rules + 3-step inline creation form + history table
- [x] `apps/web/app/dashboard/uptime/page.tsx` — status dot, uptime %, avg response, 24h bar chart
- [x] Sidebar — "Alerts" + "Uptime" added to nav
- [x] Zero TypeScript errors across all packages

### One manual step required (dev servers must be stopped first)
```bash
cd packages/db && npx prisma generate
```
The Prisma DLL was locked by running dev processes during the build — run `prisma generate` once after restarting.

---

## ✅ Phase 5 — SDK (`@runic/node`) (COMPLETE)

- [x] `packages/sdk/package.json` — `@runic/node` v0.1.0, MIT, CommonJS, no runtime deps except `fastify-plugin`
- [x] `src/types.ts` — `RunicConfig`, `IngestEvent`, `RunicClientConfig` matching exact Fastify ingest schema
- [x] `src/core/sanitizer.ts` — blocks auth/cookie headers; redacts password/secret/token/apiKey/cvv/ssn fields; truncates body at 2048 chars
- [x] `src/core/buffer.ts` — `BatchBuffer`: 500ms flush interval, max 10 events, immediate flush on size limit, `timer.unref()` so process can exit cleanly
- [x] `src/core/client.ts` — `RunicClient`: native fetch, `Authorization: Bearer`, AbortController timeout, per-status warnings (401/402/429), never throws
- [x] `src/core/errors.ts` — `captureError(error, context?)`: bypasses buffer, sends directly, warns if middleware not initialized
- [x] `src/middleware/express.ts` — patches `res.end`, captures matched route pattern via `req.route?.path`, SIGTERM/SIGINT flush, ignoreRoutes/ignoreMethods
- [x] `src/middleware/fastify.ts` — `onRequest`/`onResponse` hooks, `routerPath` for matched route, wrapped with `fastify-plugin` to avoid scope isolation
- [x] `src/index.ts` — exports only: `runic`, `runicPlugin`, `captureError`, `RunicConfig` type
- [x] `README.md` — installation, Express/Fastify quickstarts, full config table, what data is/isn't collected, graceful shutdown note
- [x] `test-app/` — Express app on port 4000 with 5 test routes, points to `http://localhost:3001`
- [x] `.npmignore` — excludes `src/`, `test-app/`, `tsconfig.json`
- [x] Zero TypeScript errors across SDK + all other packages

### To test locally
```bash
# 1. Build the SDK
cd packages/sdk && npm run build

# 2. Set your API key (from http://localhost:3000/dashboard)
export RUNIC_API_KEY=pk_live_...

# 3. Run the test app (docker compose + npm run dev must already be running)
cd packages/sdk/test-app && npm install && node index.js

# 4. Fire requests
curl http://localhost:4000/test/success
curl http://localhost:4000/test/slow
curl http://localhost:4000/test/error

# 5. Watch logs in dashboard at http://localhost:3000/dashboard
```

### To publish to npm
```bash
cd packages/sdk
npm run build          # compiles src/ → dist/
npm publish --dry-run  # preview what gets uploaded
npm publish --access public
```

---

## 📋 Phase 6 — Billing (Stripe)

- [ ] Stripe product + metered price setup
- [ ] Worker reports usage to Stripe after each batch
- [ ] Upgrade/downgrade UI
- [ ] Stripe webhook handler
- [ ] Plan enforcement in ingestion API

---

## Architecture Notes

- **Run order for local dev**: `docker compose up -d` → `npm run dev` from root
- **Env loading**: `next.config.js` loads root `.env` for Next.js server-side; `env-loader.ts` does it for api/worker
- **Raw body for webhooks**: `preParsing` Fastify hook captures body before parsing, stores as `request.rawBody`
- **Clerk JWT verification**: `verifyToken(token, { secretKey })` from `@clerk/backend` — standalone function, not a client method
- **Type-check order**: build `packages/types` → `packages/db` → then `tsc --noEmit` in apps
- **ErrorEvent upsert**: `@@unique([projectId, route, statusCode])` — Prisma compound key
- **RequestLog PK**: `@@id([id, timestamp])` — required by TimescaleDB hypertable partitioning