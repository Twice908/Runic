# Pulse Rate Limiter — Task Tracker

> This file tracks all development tasks for the Rate Limiter product line.
> Rate Limiter is **additive** — it shares all Pulse infrastructure and never replaces it.
> Always check `Claude.project.rate_limit.md` before writing any code.

---

## ✅ Phase RL-0 — Scaffolding & Schema (COMPLETE)

> Set up the foundation before writing any enforcement logic. Nothing else can start without this.

- [x] Add `RateLimitRule` model to `packages/db/prisma/schema.prisma`
- [x] Add `RateLimitEvent` model to `packages/db/prisma/schema.prisma` (TimescaleDB hypertable; composite PK `[id, timestamp]`)
- [x] Run migration: `cd packages/db && npx prisma migrate dev --name add_rate_limiter`
- [x] Create `apps/rate-limiter/` Fastify service directory (mirrors `apps/api` structure)
- [x] Add `apps/rate-limiter/package.json` with pinned exact versions (Fastify, ioredis, zod, pino, bullmq, micromatch)
- [x] Add `apps/rate-limiter/tsconfig.json` extending root tsconfig
- [x] Add `apps/rate-limiter/src/env.ts` — Zod-validated env schema (port, internal token, Redis URL, cache TTL, check timeout)
- [x] RL-specific env vars added to `apps/rate-limiter/src/env.ts` (no separate packages/config; follows existing pattern)
- [x] Update root `.env.example` with all new RL env vars and descriptions
- [x] `apps/rate-limiter` registered via existing `apps/*` workspace glob in root `package.json`; `turbo.json` global pipeline covers it
- [x] Add `RateLimitRule`, `RateLimitEvent`, `CheckRequest`, `CheckResponse`, and related types to `packages/types/src/index.ts`
- [x] Set up TimescaleDB hypertable for `RateLimitEvent` (partition on `timestamp`) — SQL added to `packages/db/prisma/timescale-setup.sql`

---

## ✅ Phase RL-1 — Core Enforcement Service (COMPLETE)

> The hot path. p99 < 5ms. No DB reads on `/v1/check`. Build and test this before any UI work.

### Redis Counter ✅
- [x] Write unit tests for sliding window counter first (window boundary conditions — requests at exact start/end must not be double-counted or dropped)
- [x] `apps/rate-limiter/src/lib/counter.ts` — atomic `INCR + EXPIREAT` pipeline; key schema `rl:{projectId}:{ruleId}:{keyValue}:{windowSlot}`
- [x] Test: `projectId` A cannot read or affect counters for `projectId` B (key isolation)

### Rule Cache ✅
- [x] `apps/rate-limiter/src/lib/rule-cache.ts` — Redis cache for rules; key `rl:rules:{projectId}`; TTL 30s
- [x] Cache miss path: fetch from DB → populate cache → proceed (never fail on miss)
- [x] Test: rule updates propagate within 30s without a service restart

### Fastify Service Bootstrap ✅
- [x] `apps/rate-limiter/src/server.ts` — Fastify instance with pino logger, auth middleware wiring, consistent error handler
- [x] `apps/rate-limiter/src/plugins/redis.ts` — shared ioredis client (`RATE_LIMITER_REDIS_URL` or fall back to `REDIS_URL`)
- [x] `apps/rate-limiter/src/plugins/prisma.ts` — re-exports `prisma` from `@pulse/db` (never instantiates a new one)
- [x] `apps/rate-limiter/src/middleware/auth.ts` — `requireInternalToken` for `/v1/rules`; `resolveProject` (with Redis project cache) for `/v1/check`

### `/v1/check` — Hot Path ✅
- [x] `apps/rate-limiter/src/routes/check.ts` — `POST /v1/check` handler
  - [x] Validate request body with Zod
  - [x] Resolve active rules from Redis cache (cache miss → DB fetch → cache populate)
  - [x] Match `path` against `pathPattern` (micromatch glob)
  - [x] Extract `keyValue` from `limitKey` (`ip` | `apiKey` | `userId` | `global`); apiKey stored as 32-char SHA-256 hash prefix (opaque, never raw key)
  - [x] Run atomic `INCR + EXPIREAT` counter
  - [x] Return `{ allowed: true|false, rule: { id, limit, remaining, resetAt } }` or `retryAfter`
  - [x] DB not read on hot path (project cache + rules cache cover it)
  - [x] Abort and fail open via `Promise.race` if check exceeds `RATE_LIMITER_CHECK_TIMEOUT_MS`
  - [x] Enqueue `RateLimitEvent` to BullMQ (fire-and-forget, `.catch(() => null)`)
- [x] Integration test: 12 tests covering all scenarios (ioredis-mock)

### RFC 6585 Response Headers ✅
- [x] `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` on every rule-evaluated response
- [x] `Retry-After` only on 429 responses
- [x] Tests verify headers present/absent correctly

### Rule Management Routes ✅
- [x] `apps/rate-limiter/src/routes/rules.ts`
  - [x] `GET /v1/rules/:projectId` — all rules for project (auth: internal token)
  - [x] `POST /v1/rules/:projectId` — create; rejects 409 on duplicate `(projectId, pathPattern, limitKey)`
  - [x] `PATCH /v1/rules/:ruleId` — update fields; invalidates Redis cache immediately
  - [x] `PUT /v1/rules/:ruleId/toggle` — flip `enabled`; invalidates Redis cache; propagates within 30s
- [x] Test: duplicate rule creation returns 409
- [x] Test: rule toggle invalidates cache and new rule state is active on next call

### Error Handling & Logging ✅
- [x] All errors: `{ success: false, error: { code, message } }` — no stack traces exposed
- [x] pino structured logging: `service: 'rate-limiter'` binding on all log lines
- [x] `keyValue` never logged; secrets and tokens never logged

---

## ✅ Phase RL-2 — Dashboard UI (COMPLETE)

> Follow existing Pulse Observe component patterns exactly. No new design systems.

### Next.js Proxy Routes ✅
- [x] `GET /api/rate-limiter/[projectId]/rules` — proxy to `GET /v1/rules/:projectId`
- [x] `POST /api/rate-limiter/[projectId]/rules` — proxy to `POST /v1/rules/:projectId`
- [x] `PATCH /api/rate-limiter/rules/[ruleId]` — proxy to `PATCH /v1/rules/:ruleId`
- [x] `PUT /api/rate-limiter/rules/[ruleId]/toggle` — proxy to `PUT /v1/rules/:ruleId/toggle`
- [x] `GET /api/rate-limiter/[projectId]/events` — proxy to `GET /v1/analytics/:projectId/events`
- [x] `GET /api/rate-limiter/[projectId]/stats` — proxy to `GET /v1/analytics/:projectId/stats`
- [x] All proxies use `proxyToRateLimiter()` (additive sibling of `proxyToApi` in `lib/api-proxy.ts`)
- Note: `/v1/check` proxy route not added — SDK calls the rate-limiter directly, not via Next.js dashboard

### Route Group & Layout ✅
- [x] Pages added under `apps/web/app/dashboard/rate-limiter/` (flat, matches actual project pattern)
- [x] "Rate Limiter" nav item added to `Sidebar.tsx` (below Uptime, with `startsWith` active logic for sub-routes)
- [x] `hooks/useRateLimiter.ts` — `useRules`, `useRuleToggle`, `useCreateRule` (mirrors `useAlerts.ts`)

### `/rules` — Rule List Page ✅
- [x] `app/dashboard/rate-limiter/rules/page.tsx` — 7 columns: name, path pattern, limit, key type, action, status, actions
- [x] Toggle per rule — `useRuleToggle` with optimistic refetch
- [x] Delete with inline `confirmDelete` state (same pattern as `AlertCard` in alerts page)
- [x] Empty state with CTA to `/rules/new`
- [x] `?created=1` success banner after redirect from `/rules/new`

### `/rules/new` — Rule Creation Form ✅
- [x] `app/dashboard/rate-limiter/rules/new/page.tsx`
  - [x] Fields: name, path pattern, limit count, window dropdown, limit key selector, action toggle
  - [x] Zod validation on submit — field errors shown inline below each input
  - [x] 409 duplicate error shown inline in a red banner (not a toast — no toast system exists)
  - [x] On success: redirect to `/rules?created=1` which shows a green banner

### `/events` — Event Log ✅
- [x] `app/dashboard/rate-limiter/events/page.tsx` — mirrors `logs/page.tsx` exactly
  - [x] Columns: timestamp, path, rule, key value, action badge, relative time
  - [x] All / Blocked / Logged filter tabs
  - [x] `useLiveRateLimitEvents` — same structure as `useLiveLogs` (3s poll, visibilityState pause, newRowIds flash)

### `/overview` — Summary Dashboard ✅
- [x] `app/dashboard/rate-limiter/page.tsx`
  - [x] 4 stat cards: total rules, enabled rules, blocked (24h), logged (24h)
  - [x] Skeleton loaders — `SkeletonCard` and `StatCard` identical to `StatsCards.tsx`
  - [x] Top IPs table and hit rate chart — empty-state placeholders (real data in RL-3)
  - [x] Quick nav tiles to /rules and /events

---

## ✅ Phase RL-3 — Analytics (COMPLETE)

> Depends on Phase RL-1 BullMQ consumer writing events. Build after `/events` page is working.

### BullMQ Consumer & TimescaleDB Writes ✅
- [x] `apps/worker/src/processors/rate-limit-event.processor.ts` — BullMQ consumer writing `RateLimitEvent` rows to TimescaleDB (batch insert via `createMany`, never individual `create()`)
- [x] Register new queue `rate-limit-events` in `apps/worker/src/index.ts`
- Note: No Stripe reporting helper exists in the codebase yet — Stripe meter increment skipped (RL-5 concern)

### Analytics Routes (`apps/rate-limiter/src/routes/analytics.ts`) ✅
- [x] `GET /v1/analytics/:projectId/stats` — total/enabled rules + blocked/logged counts (last 24h) — now powers overview page stats cards
- [x] `GET /v1/analytics/:projectId/events` — paginated event feed with filters (`ruleId`, `action`, `since`, `until`)
- [x] `GET /v1/analytics/:projectId/hit-rate` — per-rule hit/block counts over time (bucketed by hour/day)
- [x] `GET /v1/analytics/:projectId/top-offenders` — top N IPs/keys by block count, configurable window
- [x] Registered in `apps/rate-limiter/src/server.ts`

### Dashboard Analytics Pages ✅
- [x] `hooks/useRateLimitAnalytics.ts` — `useHitRate`, `useTopOffenders` hooks; 60s refresh; pause on hidden tab (mirrors `useAnalytics.ts` exactly)
- [x] `components/charts/RateLimitHitRateChart.tsx` — AreaChart with dual series (allowed blue / blocked red); mirrors `VolumeChart.tsx` structure exactly
- [x] Top offenders table — limitKey, rule name, block count, last seen
- [x] `/overview` page — placeholders replaced with real chart + real top-offenders table
- [x] Proxy routes added: `GET /api/rate-limiter/[projectId]/hit-rate`, `GET /api/rate-limiter/[projectId]/top-offenders`

### Alert Integration ✅
- [x] Added `rate_limit_spike` to `AlertType` in `packages/types/src/index.ts`
- [x] `apps/worker/src/lib/alert-evaluator.ts` — two new evaluators:
  - [x] `evaluateBlockSpike` — alert when blocked requests > threshold in last 5 minutes
  - [x] `evaluateKeyNearLimit` — alert when any single key hits ≥ 90% of rule's limitCount in last 60s
  - [x] `evaluateRateLimitAlerts(projectId)` — exported entry point called by rate-limit-event processor
- [x] Alert creation UI — `rate_limit_spike` TypeCard added to `app/dashboard/alerts/page.tsx`; badge color added

---

## ✅ Phase RL-4 — SDK Middleware (`@pulse/node`) (COMPLETE)

> Extend the existing SDK. Do not create a separate package unless the file exceeds 300 lines.

- [x] `packages/sdk/src/rate-limit.ts` — `RateLimiter` class + all types
  - [x] `RateLimitOptions`: `rules: 'auto' | RateLimitRule[]`, `failOpen: true` (default — NEVER false), `onLimited`, `headerPrefix`
  - [x] On startup (`rules: 'auto'`): fetch rules from `/v1/rules/:projectId` → cache in memory
  - [x] Background refresh every 30 seconds via `setInterval`
  - [x] HTTP call to `/v1/check` for actual enforcement (Redis counter lives on the server)
  - [x] Local pre-filter: skip `/v1/check` when cached rules have no match for the path (perf optimization)
  - [x] If Pulse unreachable: **fail open** — log error, never block user traffic
  - [x] If check exceeds 10ms: AbortController fires, fail open
  - [x] Set RFC 6585 headers on all responses when rule meta is present
- [x] Express adapter: `packages/sdk/src/middleware/rate-limit-express.ts` — `rateLimit()` mirrors `pulse()` pattern exactly
- [x] Fastify adapter: `packages/sdk/src/middleware/rate-limit-fastify.ts` — `rateLimitPlugin` wrapped with `fastify-plugin`, mirrors `pulsePlugin` pattern exactly
- [x] Export `rateLimit`, `rateLimitPlugin`, `RateLimitOptions`, `RateLimitRule`, `LimitedContext` from `packages/sdk/src/index.ts`
- [x] Test 1: fail-open when `/v1/check` returns 503 ✓
- [x] Test 2: rules fetched on startup + refreshed every 30s (fake timers + `advanceTimersByTimeAsync`) ✓
- [x] Test 3: manual rules passed → no call to `/v1/rules` ✓
- [x] Test 4: `failOpen: false` + network failure → `allowed: false` + `console.warn` called ✓
- [x] `packages/sdk/vitest.config.ts` added; `vitest` added to devDependencies
- [x] `packages/sdk/tsconfig.json` updated to exclude `*.test.ts` from build output
- [x] `packages/sdk/README.md` updated with Rate Limiting section
- [x] SDK build: `npm run build` passes with **zero TypeScript errors** ✓
- [x] Overview page rule selector: `?rule=X` URL state, `router.replace` (not push), skeleton on rule change, hidden when ≤ 1 rule

---

## 📋 Phase RL-5 — Billing Extension

> Extend existing Stripe metered billing. Do NOT create a new billing integration.

- [ ] Add meter `rate_limit_checks_monthly` to existing Stripe metered product (do not create a new Stripe product)
- [ ] `apps/worker/src/processors/rate-limit-event.processor.ts` — increment Stripe meter after each batch write (reuse existing Stripe reporting helper)
- [ ] Plan enforcement in `POST /v1/rules/:projectId`:
  - [ ] Free: max 2 rules/project; window precision: minute only
  - [ ] Starter: max 10 rules/project; window precision: second
  - [ ] Pro: unlimited rules; window precision: second; proxy mode enabled
  - [ ] Enterprise: unlimited; millisecond precision; proxy mode; custom retention
- [ ] Return `402` with clear error code when plan limit exceeded
- [ ] Dashboard: show plan limit badge on `/rules` page (e.g., "2 / 2 rules — Upgrade to add more")
- [ ] Dashboard: gate proxy mode settings behind Pro/Enterprise plan check

---

## 📋 Phase RL-6 — Proxy Mode (build last, after SDK mode is stable)

> Skip for MVP. Build only after SDK mode is shipping and stable.

- [ ] Separate entry point `apps/rate-limiter/src/proxy.ts` — standalone Fastify reverse proxy
- [ ] Accept all inbound traffic, apply rate limit rules, forward to upstream origin
- [ ] TLS termination via Let's Encrypt (ACME protocol)
- [ ] DNS/CNAME setup instructions for users (documentation)
- [ ] Proxy mode feature flag — only available on Pro/Enterprise plan (see Phase RL-5)
- [ ] End-to-end test: request → proxy → rate limit applied → forwarded to origin (or blocked with 429)

---

## Definition of Done (MVP = Phases RL-0 through RL-4)

- [ ] Developer adds `rateLimit({ rules: 'auto' })` and sees `/api/login` protected within 2 minutes
- [ ] Rule created in dashboard goes live within 30 seconds (no redeploy required)
- [ ] `/v1/check` benchmarks at 50,000 req/s on a single node
- [ ] Zero false positives from fail-open strategy (verified with Pulse unreachable test)
- [ ] All RFC 6585 headers present on every rate-limited response
- [ ] Zero TypeScript errors across all packages
- [ ] Proxy mode is NOT required for MVP

---

## Architecture Notes

- **Never touch Observe** — Rate Limiter is additive; do not modify existing routes, models, or services
- **Import, never duplicate** — use `@pulse/database`, `@pulse/queue`, `@pulse/config` directly
- **Hot path invariants**: no DB reads on `/v1/check`; all event writes via BullMQ; abort + fail open after 10ms
- **Redis key isolation**: all keys prefixed `rl:{projectId}:` — cross-project access is a security bug
- **No PII in Redis**: `keyValue` = IP / opaque API key / userId only — never email, name, password
- **Atomic counters only**: `INCR + EXPIRE` — no read-modify-write (race condition)
- **Run order**: existing `docker compose up -d` covers Redis + TimescaleDB; `apps/rate-limiter` starts on port 3002
