# Pulse — Mini Architecture Reference

> Intended use: feed this file into Claude to generate a full system design diagram for Pulse.
> Every service, data store, queue, and external dependency is listed here with its role, ports, and key connections.

---

## Product Lines

Pulse is a backend observability SaaS with three product lines sharing one monorepo and one infrastructure stack:

| Product | What it does |
|---|---|
| **Pulse Observe** | HTTP request logging, analytics, error tracking, uptime monitoring, alerting |
| **Pulse Rate Limiter** | Distributed rate limiting as a service — SDK + enforcement microservice |
| **Pulse Drift** | Env & secret drift detection — compares key-name manifests across environments and CI |
| **PAO (Pulse Agent Observe)** | AI agent run/span tracing, cost tracking, and loop detection *(in progress)* |

---

## Services Overview

### 1. `apps/api` — Ingestion & REST API (Fastify, port 3001)

The central backend. Handles all ingest traffic from the SDK and all dashboard read/write requests.

**Responsibilities:**
- Authenticates SDK requests using hashed API keys (SHA-256 Bearer token lookup)
- Accepts `POST /ingest` event batches and pushes them into BullMQ immediately — never writes to DB on the hot path (p99 < 50ms requirement)
- Serves all analytics, project management, alert CRUD, uptime, and error-tracking REST routes
- Verifies Clerk JWTs for dashboard routes; verifies Svix HMAC for Clerk webhook
- Enforces plan-level request limits (returns 402 when exceeded)
- Applies Redis-backed rate limiting on all routes (100 req / 10 s per API key or IP)

**Key routes:**
- `POST /ingest` — SDK event ingestion
- `GET|POST /projects/:id/...` — project management, stats, logs
- `GET /projects/:id/analytics/{volume,latency,top-routes,errors}` — analytics queries
- `GET|POST|PATCH|DELETE /projects/:id/alerts` — alert CRUD
- `GET /projects/:id/uptime` — uptime check history
- `POST /webhooks/clerk` — user sync from Clerk

**Auth used:**
- Bearer API key (ingest): SHA-256 hash comparison against `Project.apiKeyHash`
- Clerk JWT (dashboard routes): `@clerk/backend` `verifyToken`
- Svix HMAC (Clerk webhook)

**Connections:**
- → PostgreSQL/TimescaleDB (reads for analytics, auth lookups)
- → Redis (rate-limit counters, BullMQ queue producer)
- ← SDK (`@pulse/node`) via HTTP

---

### 2. `apps/rate-limiter` — Rate Limiter Service (Fastify, port 3002)

A dedicated microservice for the Pulse Rate Limiter product. Completely separate from `apps/api`.

**Responsibilities:**
- Hot-path enforcement at `POST /v1/check` — target p99 < 5ms
- Rule storage and retrieval (DB-backed, Redis-cached with 30s TTL)
- Atomic Redis counter increment for fixed-window rate limiting
- Fires `RateLimitEvent` jobs to BullMQ (fire-and-forget, no sync DB write on hot path)

**Key routes:**
- `POST /v1/check` — hot path: validates API key from cache, matches rules from cache, increments Redis counter, returns `{ allowed, rule, retryAfter }`
- `GET|POST /v1/rules/:projectId` — rule CRUD
- `PATCH /v1/rules/:ruleId` — rule update
- `PUT /v1/rules/:ruleId/toggle` — enable/disable (propagates within 30s via Redis cache invalidation)
- `GET /v1/analytics/:projectId/{events,stats,hit-rate,top-offenders}` — analytics

**Auth used:**
- API key cache lookup for `/v1/check` (Redis → DB on cache miss)
- `RATE_LIMITER_INTERNAL_TOKEN` Bearer token for all `/v1/rules` and `/v1/analytics` routes (set by Next.js proxy)

**Redis keys:**
- `rl:{projectId}:{ruleId}:{keyValue}:{windowSlot}` — atomic INCR counter, EXPIREAT window end
- `rl:rules:{projectId}` — JSON array of enabled rules, TTL 30s
- `rl:project:{sha256(apiKey)}` — project ID lookup cache, TTL 60s

**Non-negotiables:**
- No DB reads on `/v1/check` hot path (Redis only; DB only on cache miss)
- Fail open if Redis or the service is unreachable
- Atomic INCR only — no read-modify-write

**Connections:**
- → Redis (counters, rule cache, project cache)
- → PostgreSQL (rule persistence, cache-miss fallback)
- → BullMQ (enqueue `RateLimitEvent` jobs)
- ← SDK (`rateLimit()` middleware) via HTTP

---

### 3. `apps/drift-detector` — Env & Secret Drift Detector (Fastify, port 3003)

A dedicated Fastify microservice that collects environment variable key-name manifests from deployed services, diffs them against a baseline environment, and surfaces missing, extra, or stale-rotation keys on the dashboard and in CI.

**Core concept:** The agent SDK (`packages/sdk-drift`) runs on the customer's server or in CI, reads `Object.keys(process.env)`, strips ignored system keys, validates names against `/^[A-Z][A-Z0-9_]*$/`, and POSTs **key names only — never values** to `POST /v1/snapshot`. The diff worker then compares the snapshot against the designated baseline environment and produces `DriftEvent` records.

**Responsibilities:**
- Accepts manifest snapshots from the agent SDK (API key auth, same pattern as ingest)
- Enqueues diff jobs to BullMQ `drift-diff` queue immediately (returns 202, never blocks)
- Serves matrix, events, keys, environments, and CI-check routes for the dashboard and CI pipeline
- Stores project API key → project ID mapping in Redis (TTL 60s, SHA-256 key hash — same pattern as rate limiter)
- Caches the comparison matrix in Redis (key `matrix:{projectId}`, TTL 30s) for fast dashboard loads
- Never stores secret values — key names only, always

**Key routes:**

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `POST` | `/v1/snapshot` | API key | Receive manifest → upsert `DriftEnvironment` + `DriftManifest` → enqueue diff job. Returns 202 `{ received, driftJobId }` |
| `GET` | `/v1/matrix/:projectId` | Internal token | Comparison matrix (rows=keys, cols=envs). Redis-cached 30s. CTE SQL query, < 500ms for 10 envs × 200 keys |
| `GET` | `/v1/events/:projectId` | Internal token | Paginated `DriftEvent[]`, default unresolved, desc |
| `GET` | `/v1/keys/:projectId` | Internal token | `DriftKeyMeta[]` with drift status and days overdue |
| `PATCH` | `/v1/keys/:projectId/:keyName` | Internal token | Update key metadata; `isIgnored=true` immediately resolves all open events for that key |
| `POST` | `/v1/baseline/:projectId` | Internal token | Set baseline environment; re-enqueues diff for all other envs |
| `GET` | `/v1/ci-check/:projectId` | API key | `{ passed, missingKeys, extraKeys, driftScore }`. Always HTTP 200 — never 4xx on drift |

**Diff worker logic (BullMQ `drift-diff` queue):**
1. Load new manifest + baseline latest manifest + env's previous manifest
2. `missingKeys` = baseline.keys − env.keys; `extraKeys` = env.keys − baseline.keys
3. Skip ignored keys (`DriftKeyMeta.isIgnored`)
4. Create `DriftEvent` for new drift; resolve existing events for fixed keys (`KEY_RESTORED`)
5. Check `rotationDays` → if `now − lastChangedAt > rotationDays` → `STALE_ROTATION` event
6. `DriftScore = clamp(100 − (missing×10) − (extra×5) − (stale×15), 0, 100)`
7. Invalidate Redis matrix cache; fire alerts via existing alert dispatch pipeline

**New data models (added to `packages/db`):**
- `DriftEnvironment` — `id, projectId, name, isBaseline, driftScore(0–100), lastSeenAt`; unique `[projectId, name]`
- `DriftManifest` — `id, environmentId, projectId, keys String[], agentVersion?, capturedAt`
- `DriftEvent` — `id, projectId, environmentId, keyName, driftType(enum), detectedAt, resolvedAt?, resolved`
- `DriftKeyMeta` — `id, projectId, environmentId?, keyName, description?, owner?, rotationDays?, isIgnored, ignoreReason?`
- `DriftEventType` enum — `MISSING_KEY | EXTRA_KEY | STALE_ROTATION | KEY_RESTORED`

**`packages/sdk-drift` — Agent SDK & CLI:**
- `pulse-drift snapshot --env production --project-key pk_live_xxx` — extracts key names, posts to `/v1/snapshot`
- `pulse-drift watch --env staging --interval 15` — continuous polling mode
- `pulse-drift ci-check --env staging --fail-on-drift` — returns non-zero exit if drift detected; used in GitHub Actions
- Hardcoded ignore list: `PATH HOME USER SHELL TERM PWD _ SHLVL OLDPWD LOGNAME TMPDIR ...`
- GitHub Action (`drift-action/`) bundles the CI check as a self-contained ncc-compiled action

**Dashboard pages (under `/dashboard/[projectId]/drift/`):**
- `overview/` — DriftScore cards + recent events
- `matrix/` — server-rendered RSC grid (rows=keys, cols=envs; color-coded: green/red/amber/blue/grey)
- `events/` — filterable event feed
- `keys/` — metadata editor (description, owner, rotationDays, isIgnored)
- `environments/` — add/set baseline/delete environments
- `settings/` — agent setup + CI snippet generator

**Redis keys:**
- `drift:project:{sha256(apiKey)}` — project ID lookup cache, TTL 60s
- `matrix:{projectId}` — serialized comparison matrix, TTL 30s (invalidated on new snapshot or diff)
- Alert debounce pattern reused from existing `alert:debounce:{alertId}`

**Connections:**
- → PostgreSQL (drift model reads/writes via Prisma)
- → Redis (project cache, matrix cache, BullMQ queue producer)
- → `apps/worker` alert pipeline (reuses `dispatch()` in `notifications.ts` for drift alerts)
- ← `packages/sdk-drift` agent (HTTP POST, Bearer API key)
- ← `apps/web` Next.js proxy (HTTP, `DRIFT_INTERNAL_TOKEN`)

---

### 4. `apps/worker` — Background Worker (BullMQ, no HTTP port)

A long-running Node.js process that dequeues BullMQ jobs and writes to the database.

**Processors and queues:**

| Queue | Processor file | Concurrency | What it does |
|---|---|---|---|
| `ingest` | `ingest.processor.ts` | 10 | Writes `RequestLog` row; upserts `ErrorEvent` if status ≥ 400; fire-and-forgets `evaluateObserveAlerts()` |
| `uptime` | `uptime.processor.ts` | 1 (repeatable, every 60s) | Pings all active uptime alert URLs with 10s timeout; writes `UptimeCheck`; calls `evaluateUptimeAlerts()` |
| `observe-alerts` | `observe-alerts.processor.ts` | 1 (repeatable, every 60s) | Finds all projects with active `error_rate` / `response_time` alerts; calls `evaluateObserveAlerts()` |
| `rate-limit-events` | `rate-limit-event.processor.ts` | 10 | Writes `RateLimitEvent` to DB; calls `evaluateRateLimitAlerts()` (fire-and-forget) |

**Alert evaluation engine (`lib/alert-evaluator.ts`):**
- `evaluateErrorRate()` — queries `RequestLog` for error% in last 5 min; fires if > threshold
- `evaluateResponseTime()` — `percentile_cont(0.99)` on `RequestLog` in last 5 min; fires if > threshold (ms)
- `evaluateUptime()` — state-machine: fires on `down` transition (Redis state key); clears debounce on recovery
- `evaluateRateLimitSpikeAlert()` — counts blocked events in last 5 min; fires if > threshold; uses Redis eval lock to prevent concurrent evaluation

**Debounce/state keys (Redis):**
- `alert:debounce:{alertId}` — TTL 300s (uptime/rate spike) or 600s (error rate/response time) — prevents repeated alert firing
- `alert:uptime:state:{alertId}` — stores `'up'|'down'` for state transition detection, TTL 3600s
- `alert:debounce:{alertId}:spike` — separate debounce for rate_limit_spike alerts
- `rl:eval:lock:{projectId}` — 5s mutex on rate-limit alert evaluation

**Notification dispatch (`lib/notifications.ts`):**
- Sends email via Resend API
- Sends Slack messages via webhook URL
- Writes `AlertEvent` record after successful dispatch

**Connections:**
- → PostgreSQL/TimescaleDB (all DB writes)
- → Redis (BullMQ consumer, debounce keys, alert state keys)
- → Resend API (email alerts, HTTPS)
- → Slack (webhook POST, HTTPS)

---

### 4. `apps/web` — Dashboard (Next.js 14 App Router, port 3000)

The user-facing dashboard. All pages require Clerk authentication.

**Architecture pattern:**
- Server Components (layout, initial data fetch) talk directly to PostgreSQL via Prisma
- Client Components poll Next.js API proxy routes (`/api/*`) every 3–60 seconds
- Next.js API routes proxy to `apps/api` (port 3001) or `apps/rate-limiter` (port 3002), injecting Clerk JWT or internal token

**Dashboard pages:**

| URL | Feature | Poll interval |
|---|---|---|
| `/dashboard` | Overview: stats cards + request log table | On-demand |
| `/dashboard/logs` | Live request log feed | 3 seconds |
| `/dashboard/analytics` | Volume chart, latency percentiles, top routes, error rate | 60 seconds |
| `/dashboard/errors` | Error groups with resolve/unresolve | 60 seconds |
| `/dashboard/alerts` | Alert rule CRUD + history | On-demand |
| `/dashboard/uptime` | Uptime status + bar chart | 60 seconds |
| `/dashboard/rate-limiter` | Rate limit overview: hit rate chart, top offenders | 60 seconds |
| `/dashboard/rate-limiter/rules` | Rule list with enable/disable toggle | On-demand |
| `/dashboard/rate-limiter/events` | Live feed of rate limit events | 3 seconds |

**Auth:**
- Clerk middleware gates all `/dashboard/**` routes
- Server components call `auth()` and redirect if unauthenticated
- Client components call `getToken()` and attach `Authorization: Bearer {jwt}` to all proxied fetch calls
- Dashboard layout upserts `User` row directly if Clerk webhook hasn't fired (local dev fallback)

**Connections:**
- → PostgreSQL/TimescaleDB (direct Prisma access in server components)
- → `apps/api` (via `proxyToApi()` in Next.js API routes)
- → `apps/rate-limiter` (via Next.js proxy routes with internal token)
- → Clerk (session management, JWT issuance)

---

## Packages

### `packages/db` — Prisma ORM + PrismaClient

Shared across all apps. Exports a singleton `PrismaClient`. Contains the Prisma schema and all migrations.

**Data models:**
- `User` — Clerk user synced via webhook; holds plan tier
- `Project` — API key hash, prefix; linked to User
- `RequestLog` — TimescaleDB hypertable on `timestamp`; composite PK `[id, timestamp]`
- `ErrorEvent` — grouped by `[projectId, route, statusCode]`; deduplicated with upsert
- `UptimeCheck` — one row per URL ping
- `Alert` — alert rule definition (type, threshold, channel, destination)
- `AlertEvent` — fired alert record with triggered value
- `RateLimitRule` — rate limit rule (pathPattern, limitKey, limitCount, windowSecs, action)
- `RateLimitEvent` — TimescaleDB hypertable on `timestamp`; one row per check event
- `AgentDefinition` *(PAO, in progress)* — agent registry by project
- `AgentRun` *(PAO, in progress)* — top-level agent execution record
- `AgentSpan` *(PAO, in progress)* — individual span (llm_call, tool_call, etc.), TimescaleDB hypertable

---

### `packages/sdk-drift` — `@pulse/drift` CLI & Agent SDK

Installed on the customer's server or in CI pipelines. Not an HTTP middleware — it's an agent/CLI tool.

- Extracts `Object.keys(process.env)`, filters system noise, validates key name format
- POSTs key names (never values) to `POST /v1/snapshot` on `apps/drift-detector`
- CLI commands: `snapshot`, `watch`, `ci-check`
- GitHub Action (`drift-action/`) compiled with ncc — no runtime dependencies at the runner

---

### `packages/types` — Shared TypeScript Types

No runtime code. Exports all shared interfaces: `IngestEvent`, `RequestLogRow`, `ProjectStats`, `AlertRule`, `UptimeStatus`, `VolumeBucket`, `LatencyBucket`, `TopRoute`, `ErrorGroup`, `RateLimitRuleRecord`, `AgentSpanPayload`, etc.

---

### `packages/sdk` — `@pulse/node` npm package

Installed in the customer's backend application. Exports:

- `pulse(config)` — Express `RequestHandler` middleware for Pulse Observe
- `pulsePlugin(config)` — Fastify plugin for Pulse Observe
- `captureError(err, ctx?)` — manual error report; bypasses buffer, sends immediately
- `rateLimit(options)` — Express middleware for Pulse Rate Limiter
- `rateLimitPlugin(options)` — Fastify plugin for Pulse Rate Limiter

**`pulse()` middleware behaviour:**
1. Monkey-patches `res.end` (Express) or hooks `onRequest`/`onResponse` (Fastify)
2. Captures `method`, `route`, `statusCode`, `responseTime`, `timestamp`
3. Adds event to `BatchBuffer`; buffer flushes every 500ms or when 10 events accumulate
4. `PulseClient` POSTs batch to `POST /ingest` with Bearer API key
5. Never throws, never retries, never blocks — fail-silent
6. Skips requests with `X-Pulse-Skip-Log: true` header (used by uptime pinger)
7. Sanitizes headers: strips Authorization, Cookie, X-Api-Key before any send

**`rateLimit()` middleware behaviour:**
1. Fetches rules from `/v1/rules/:projectId` on startup; refreshes every 30s
2. Per request: local glob pre-filter → if a rule could match, POST to `/v1/check`
3. If `allowed: false`: sets RFC 6585 headers, returns 429 with `Retry-After`
4. If `allowed: true`: calls `next()`
5. Fail open on any error, timeout, or non-200 from `/v1/check` — hardcoded default

---

## Infrastructure

### TimescaleDB (PostgreSQL extension, port 5432)

Used as both the relational app DB and the time-series metrics store.

**Hypertables (partitioned by time):**
- `RequestLog` — partitioned on `timestamp`
- `RateLimitEvent` — partitioned on `timestamp`
- `AgentSpan` *(PAO)* — partitioned on `startedAt`

**Continuous aggregates (materialized views refreshed by TimescaleDB):**
- `request_stats_hourly` — 1-hour buckets, refreshed every 30 min; serves 1h and 6h range queries
- `request_stats_daily` — 1-day buckets, refreshed every 1 hour; serves 24h and 7d range queries

**Percentile queries (P50/P90/P99) are NOT materialized** — always run `percentile_cont` on the raw hypertable via the composite index `(projectId, timestamp DESC)`.

---

### Redis (port 6379)

Dual-purpose: BullMQ transport and operational key-value store.

**BullMQ queues:**
- `ingest` — ingest events from SDK, concurrency 10
- `uptime` — repeatable job every 60s for uptime pings
- `observe-alerts` — repeatable job every 60s for error_rate / response_time checks
- `rate-limit-events` — rate limit event writes, concurrency 10
- `drift-diff` — env manifest diff jobs from `apps/drift-detector`, concurrency configurable

**Operational keys:**
- Rate-limit counters (`rl:...`)
- Rule cache for rate limiter (`rl:rules:...`)
- Project API key cache for rate limiter (`rl:project:...`)
- Alert debounce keys (`alert:debounce:...`)
- Uptime alert state keys (`alert:uptime:state:...`)
- Rate-limit alert evaluation mutex (`rl:eval:lock:...`)
- Rate-limit keys for `apps/api` request rate limiting (`rl:key:...`, `rl:ip:...`)
- Drift project API key cache (`drift:project:...`)
- Drift comparison matrix cache (`matrix:{projectId}`)

---

### Clerk (external SaaS, auth)

Manages user sign-up, sign-in, session JWTs, and user lifecycle webhooks.

- Browser → Clerk issues short-lived JWTs
- `apps/web` attaches JWT to every proxied API call
- `apps/api` verifies JWT with `@clerk/backend` `verifyToken`
- Clerk fires `user.created` webhook to `apps/api POST /webhooks/clerk` → upserts `User` row in DB
- Svix HMAC signature verification used to authenticate webhook payloads

---

### Resend (external SaaS, email)

Used exclusively by `apps/worker` to send alert notification emails.

- Worker calls Resend API when an alert fires (channel = 'email')
- Requires `RESEND_API_KEY` and `RESEND_FROM_EMAIL` env vars
- Silently skipped if `RESEND_API_KEY` is not set

---

### Slack (external, webhook)

Used exclusively by `apps/worker` to post alert notifications.

- Worker POSTs to a Slack incoming webhook URL stored in `Alert.destination`
- No Slack app or OAuth required — just a webhook URL

---

## End-to-End Data Flows

### Flow 1 — HTTP Request Ingestion (Pulse Observe)

```
Customer Backend
  → pulse() middleware patches res.end
  → BatchBuffer accumulates events (max 500ms or 10 events)
  → PulseClient POSTs { events[] } to POST /ingest (Bearer API key)
  → apps/api validates key (SHA-256 hash lookup in DB)
  → apps/api checks plan limit (isOverPlanLimit)
  → apps/api pushes one BullMQ job per event to 'ingest' queue in Redis
  → apps/api returns { success: true, queued: N } immediately
  → apps/worker ingest.processor dequeues job
  → Writes RequestLog row to TimescaleDB
  → If statusCode >= 400: upserts ErrorEvent (increments count, updates lastSeen)
  → Calls evaluateObserveAlerts(projectId) fire-and-forget
```

### Flow 2 — Rate Limit Check (Pulse Rate Limiter)

```
Customer Backend
  → rateLimit() middleware pre-filters by glob match
  → POSTs to apps/rate-limiter POST /v1/check (project ID + IP + path + headers)
  → rate-limiter resolves project from Redis cache (SHA-256 API key hash)
  → rate-limiter loads rules from Redis cache (rl:rules:{projectId})
  → rate-limiter runs INCR + EXPIREAT on counter key (atomic, no read-modify-write)
  → Returns { allowed, rule, retryAfter }
  → If allowed=false: SDK sets X-RateLimit headers + Retry-After, returns 429
  → If allowed=true: SDK calls next()
  → rate-limiter enqueues RateLimitEvent job to 'rate-limit-events' queue (fire-and-forget)
  → apps/worker rate-limit-event.processor writes RateLimitEvent row
  → Calls evaluateRateLimitAlerts(projectId) fire-and-forget
```

### Flow 3 — Alert Evaluation and Dispatch

```
apps/worker (observe-alerts processor, every 60s)
  → Finds all projects with active error_rate / response_time alerts
  → For each project: queries RequestLog in last 5 min
  → If threshold exceeded AND debounce key absent:
      → Sets debounce key in Redis (TTL 300–600s)
      → Calls dispatch() in notifications.ts
      → Sends email via Resend OR posts to Slack webhook
      → Writes AlertEvent row in DB

apps/worker (uptime processor, every 60s)
  → Finds all active uptime alerts with a URL
  → HTTP GET each URL (10s timeout, X-Pulse-Skip-Log: true header)
  → Writes UptimeCheck row
  → Reads previous state from Redis (alert:uptime:state:{alertId})
  → If status transitioned to 'down': fires alert (same dispatch path as above)
  → Updates state key in Redis
```

### Flow 4 — Dashboard Analytics Request

```
Browser (client component hook, e.g. useVolumeData)
  → GET /api/projects/{id}/analytics/volume?range=24h (Next.js API route)
  → Next.js route calls proxyToApi() — attaches Clerk JWT
  → apps/api GET /projects/{id}/analytics/volume
  → Verifies Clerk JWT, looks up User by clerkId
  → Queries request_stats_daily continuous aggregate (for 24h range)
  → Returns { success, data: VolumeBucket[] }
  → Next.js proxy returns same JSON to browser
  → Hook updates state → VolumeChart re-renders
```

---

## Environment Variables (by service)

| Variable | Service | Purpose |
|---|---|---|
| `DATABASE_URL` | api, worker, web, rate-limiter | PostgreSQL connection string |
| `REDIS_URL` | api, worker, rate-limiter | Redis connection URL |
| `PORT` | api | Fastify listen port (default 3001) |
| `RATE_LIMITER_PORT` | rate-limiter | Listen port (default 3002) |
| `API_KEY_SECRET` | api | Secret for API key generation (min 32 chars) |
| `CLERK_SECRET_KEY` | api, web | Clerk backend JWT verification key |
| `CLERK_WEBHOOK_SECRET` | api | Svix HMAC verification for Clerk webhook |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | web (browser) | Clerk frontend key |
| `RESEND_API_KEY` | worker | Resend email delivery key |
| `RESEND_FROM_EMAIL` | worker | Alert email sender address |
| `RATE_LIMITER_INTERNAL_TOKEN` | rate-limiter, web | Internal auth token for rule/analytics routes |
| `RATE_LIMITER_RULE_CACHE_TTL` | rate-limiter | Rule cache TTL in Redis (default 30s) |
| `RATE_LIMITER_CHECK_TIMEOUT_MS` | rate-limiter | Hot-path abort timeout (default 1000ms) |
| `DRIFT_COLLECTOR_PORT` | drift-detector | Listen port (default 3003) |
| `DRIFT_INTERNAL_TOKEN` | drift-detector, web | Bearer token for dashboard → drift-detector routes |
| `DRIFT_REDIS_KEY_MATRIX_TTL` | drift-detector | Matrix cache TTL in Redis (default 30s) |
| `DRIFT_MAX_KEYS_PER_SNAPSHOT` | drift-detector | Max env keys per snapshot (default 500) |
| `PULSE_DRIFT_API_URL` | sdk-drift | URL of apps/drift-detector (default https://drift.pulseobserve.com) |
| `PULSE_DRIFT_ENV` | sdk-drift | Environment name used in snapshots |
| `INGESTION_API_URL` | web | apps/api base URL for Next.js proxy |
| `NEXT_PUBLIC_APP_URL` | worker | Dashboard URL embedded in alert emails |
| `PULSE_HOST` | sdk consumer | Override ingest endpoint (default: https://api.pulse.dev) |
| `PULSE_PROJECT_ID` | sdk consumer | Project ID for rateLimit() middleware |
| `RATE_LIMITER_URL` | sdk consumer, web | URL of apps/rate-limiter |

---

## Inter-Service Dependency Map

```
@pulse/types ──────────────────────────────────────────────┐
                                                            │ (imported by all)
@pulse/db (PrismaClient) ──────────────────────────────────┤
                                                            │
apps/api ────────────→ PostgreSQL/TimescaleDB               │
         ────────────→ Redis (BullMQ producer + rate limit) │
         ←────────────── @pulse/node SDK (HTTP POST)        │
                                                            │
apps/rate-limiter ──→ Redis (counters + rule cache)         │
                  ──→ PostgreSQL (rule storage)             │
                  ──→ Redis (BullMQ producer)               │
                  ←── @pulse/node SDK rateLimit() (HTTP POST)
                  ←── apps/web proxy (HTTP, internal token) │
                                                            │
apps/worker ────────→ PostgreSQL/TimescaleDB (all writes)   │
            ────────→ Redis (BullMQ consumer + debounce)    │
            ────────→ Resend API (email, HTTPS)             │
            ────────→ Slack (webhook POST, HTTPS)           │
                                                            │
apps/drift-detector → PostgreSQL (drift model reads/writes)
                    → Redis (project cache, matrix cache, BullMQ producer)
                    → apps/worker alert pipeline (reuses dispatch() for drift alerts)
                    ← packages/sdk-drift agent (HTTP POST, API key)
                    ← apps/web proxy (HTTP, DRIFT_INTERNAL_TOKEN)

apps/web ───────────→ PostgreSQL/TimescaleDB (server components, direct Prisma)
         ───────────→ apps/api (Next.js API proxy, Clerk JWT)
         ───────────→ apps/rate-limiter (Next.js API proxy, internal token)
         ───────────→ apps/drift-detector (Next.js API proxy, DRIFT_INTERNAL_TOKEN)
         ←────────── Clerk (JWT issuance + session management)
         ←────────── Browser (polling every 3–60s per page)
```

---

## Plan Tiers

| Plan | Price | Requests/mo | Projects | Log retention |
|---|---|---|---|---|
| Free | $0 | 50,000 | 1 | 24 hours |
| Starter | $19/mo | 1,000,000 | 3 | 7 days |
| Pro | $79/mo | 10,000,000 | Unlimited | 30 days |
| Enterprise | Custom | Custom | Unlimited | Custom |

- Exceeding the Free tier request limit → `apps/api` returns HTTP 402
- Data retention enforced via TimescaleDB retention policies (not manual deletes)
- Stripe billing is planned (Phase 6) — no code exists yet

---

## What Is Not Yet Built

| Feature | Status |
|---|---|
| Stripe billing integration | Env vars stubbed only; no code |
| SDK body/header capture (`captureBody`, `captureHeaders`) | Types exist; logic not implemented |
| Pulse Drift — stale rotation alerts + D-4 CI check | D-1 through D-3 complete; D-4 (ci-check route + GitHub Action) complete as of 2026-05-28 |
| PAO (Pulse Agent Observe) ingestion + dashboard | In design phase; Prisma models designed but not yet migrated |
| Rate Limiter proxy mode (reverse proxy entry point) | Planned Phase RL-4; not started |
| Rate Limiter — additional framework adapters (Hono, Koa) | Not started |