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

## 📋 Phase RL-2 — Dashboard UI

> Follow existing Pulse Observe component patterns exactly. No new design systems.

### Next.js Proxy Routes (`apps/web/app/api/rate-limiter/`)
- [ ] `POST /api/rate-limiter/[projectId]/check` — proxy to `POST /v1/check`
- [ ] `GET /api/rate-limiter/[projectId]/rules` — proxy to `GET /v1/rules/:projectId`
- [ ] `POST /api/rate-limiter/[projectId]/rules` — proxy to `POST /v1/rules/:projectId`
- [ ] `PATCH /api/rate-limiter/rules/[ruleId]` — proxy to `PATCH /v1/rules/:ruleId`
- [ ] `PUT /api/rate-limiter/rules/[ruleId]/toggle` — proxy to `PUT /v1/rules/:ruleId/toggle`
- [ ] All proxies use existing `proxyToApi()` helper from `apps/web/lib/api-proxy.ts`

### Route Group & Layout
- [ ] Create `apps/web/app/dashboard/[projectId]/rate-limiter/` route group
- [ ] Add "Rate Limiter" nav item to existing `Sidebar.tsx` (below Alerts/Uptime)
- [ ] `hooks/useRateLimiter.ts` — `useRules`, `useRuleToggle`, `useCreateRule` hooks (mirror pattern from `useAlerts.ts`)

### `/rules` — Rule List Page
- [ ] `app/dashboard/[projectId]/rate-limiter/rules/page.tsx` — rule list with columns: name, path pattern, limit, window, key type, status badge, actions
- [ ] Enable/disable toggle per rule (calls `PUT /v1/rules/:ruleId/toggle`, optimistic UI update)
- [ ] Delete rule with confirmation dialog
- [ ] Empty state with CTA to create first rule

### `/rules/new` — Rule Creation Form
- [ ] `app/dashboard/[projectId]/rate-limiter/rules/new/page.tsx` — creation form
  - [ ] Fields: name, path pattern (glob), limit count, window (duration picker), limit key (`ip`/`apiKey`/`userId`/`global`), action (`block`/`log_only`)
  - [ ] Live preview panel showing what traffic would currently be blocked by this rule
  - [ ] Zod validation on submit; show 409 duplicate error inline
  - [ ] Redirect to `/rules` on success with success toast

### `/events` — Event Log
- [ ] `app/dashboard/[projectId]/rate-limiter/events/page.tsx` — live feed of rate limit events (mirror `app/dashboard/logs/page.tsx` pattern)
- [ ] Columns: timestamp, path, rule name, key value (IP/apiKey/userId), action (blocked/logged), relative time
- [ ] Status filter: All / Blocked / Logged
- [ ] Polling every 3s on active tab, pause on hidden tab (reuse `useLiveLogs` pattern)

### `/overview` — Summary Dashboard
- [ ] `app/dashboard/[projectId]/rate-limiter/overview/page.tsx`
  - [ ] Rule summary cards (total rules, enabled rules, blocked last 24h, logged last 24h)
  - [ ] Top blocked IPs/keys table (last 24h)
  - [ ] Hit rate mini-chart per rule (bar or sparkline)
  - [ ] Skeleton loaders on all cards (match `StatsCards.tsx` pattern)

---

## 📋 Phase RL-3 — Analytics

> Depends on Phase RL-1 BullMQ consumer writing events. Build after `/events` page is working.

### BullMQ Consumer & TimescaleDB Writes
- [ ] `apps/worker/src/processors/rate-limit-event.processor.ts` — BullMQ consumer writing `RateLimitEvent` rows to TimescaleDB (batch insert, never one-by-one)
- [ ] Register new queue in `apps/worker/src/index.ts`
- [ ] Test: worker correctly writes events; test with `ioredis-mock` in CI

### Analytics Routes (`apps/rate-limiter/src/routes/analytics.ts`)
- [ ] `GET /v1/analytics/:projectId/events` — paginated event feed with filters (`ruleId`, `action`, `since`, `until`)
- [ ] `GET /v1/analytics/:projectId/hit-rate` — per-rule hit/block counts over time (bucketed by hour/day)
- [ ] `GET /v1/analytics/:projectId/top-offenders` — top N IPs/keys by block count, configurable window

### Dashboard Analytics Pages
- [ ] `hooks/useRateLimitAnalytics.ts` — `useHitRate`, `useTopOffenders` hooks; 60s refresh; pause on hidden tab
- [ ] Hit rate chart per rule — AreaChart with dual series (allowed blue / blocked red); mirror `VolumeChart.tsx` pattern
- [ ] Block rate over time — LineChart per rule; y-axis as percentage
- [ ] Top offenders table — IP/key, rule triggered, block count, last seen; sortable columns
- [ ] Add analytics charts to `/overview` page (replace placeholder cards)

### Alert Integration
- [ ] Reuse existing alert channels (email + Slack) from Phase 4 of Observe — do NOT rebuild
- [ ] Add alert type `rate_limit_spike` to `packages/types`
- [ ] `apps/worker/src/lib/alert-evaluator.ts` — add two new evaluators:
  - [ ] Alert when a rule blocks > N requests in M minutes (configurable threshold)
  - [ ] Alert when a single IP/key hits > 90% of limit within a window
- [ ] Alert creation UI — add `rate_limit_spike` option to existing alert creation form in `app/dashboard/alerts/page.tsx`

---

## 📋 Phase RL-4 — SDK Middleware (`@pulse/node`)

> Extend the existing SDK. Do not create a separate package unless the file exceeds 300 lines.

- [ ] `packages/sdk/src/rate-limit.ts` — `rateLimit()` middleware
  - [ ] Accept `RateLimitOptions`: `rules: 'auto' | RateLimitRule[]`, `failOpen: true` (default — NEVER false), `onLimited`, `headerPrefix`
  - [ ] On startup: fetch rules from `/v1/rules/:projectId` → cache in memory
  - [ ] Background refresh every 30 seconds
  - [ ] If user's backend has Redis: perform counter check locally (faster path)
  - [ ] If no Redis: HTTP call to `/v1/check`
  - [ ] If Pulse unreachable: **fail open** (let request through), log error — never block user traffic
  - [ ] If check exceeds 10ms: abort and fail open
  - [ ] Set RFC 6585 headers on all responses passing through middleware
- [ ] Express adapter for `rateLimit()` (mirror `pulse()` Express middleware pattern)
- [ ] Fastify adapter for `rateLimit()` (wrapped with `fastify-plugin`)
- [ ] Export `rateLimit` and `RateLimitOptions`, `RateLimitRule` types from `packages/sdk/src/index.ts`
- [ ] Test: fail-open behavior when Pulse returns 5xx or times out
- [ ] Test: rules are fetched on startup and refreshed every 30s
- [ ] Test: manual rule override works in local dev (no network call)
- [ ] Update `packages/sdk/README.md` with `rateLimit()` usage section
- [ ] Rebuild SDK: `cd packages/sdk && npm run build`

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
