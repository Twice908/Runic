# CLAUDE.codebase.md — Pulse Permanent Codebase Map

> **Purpose**: Let Claude Code understand the entire project structure, every feature, every file's responsibility, and every known issue without reading individual source files first.
> **Rule**: Never modify source files based on this document. This is a read-only map.

---

## 1. Monorepo Structure

| App / Package | Description | Port |
|---|---|---|
| `apps/api` | Fastify REST API — handles ingest, analytics, projects, alerts, Clerk webhooks | `3001` (env: `PORT`) |
| `apps/rate-limiter` | Fastify rate-limiter microservice — hot-path `/v1/check`, rule CRUD, analytics | `3002` (env: `RATE_LIMITER_PORT`) |
| `apps/worker` | BullMQ background worker — ingest processor, uptime pinger, alert evaluator | No HTTP port |
| `apps/web` | Next.js 14 dashboard — renders all Observe + Rate Limiter UI, proxies API calls | `3000` (Next.js default) |
| `packages/db` | Prisma schema (`schema.prisma`) + singleton `PrismaClient` export | N/A |
| `packages/sdk` | npm package — `pulse()` Express middleware, `pulsePlugin()` Fastify plugin, `rateLimit()` Express middleware, `rateLimitPlugin()` Fastify plugin | N/A |
| `packages/types` | Shared TypeScript types used across all apps | N/A |

**Build order**: `packages/types` → `packages/db` → `packages/sdk` → `apps/*`

---

## 2. Data Models

### User
| Field | Type | Notes |
|---|---|---|
| `id` | String (cuid) | PK |
| `email` | String unique | From Clerk webhook |
| `clerkId` | String unique | Clerk user ID |
| `plan` | Enum Plan | FREE / STARTER / PRO / ENTERPRISE |
| `createdAt` | DateTime | |

**Relations**: `projects Project[]`

---

### Project
| Field | Type | Notes |
|---|---|---|
| `id` | String (cuid) | PK |
| `name` | String | Display name |
| `apiKeyHash` | String unique | SHA-256 of raw API key — never store plaintext |
| `apiKeyPrefix` | String | First 8 chars of raw key shown in UI |
| `userId` | String | FK → User |

**Relations**: `User`, `RequestLog[]`, `ErrorEvent[]`, `UptimeCheck[]`, `Alert[]`, `AlertEvent[]`, `RateLimitRule[]`, `RateLimitEvent[]`
**Owned by**: Pulse Observe + Rate Limiter (shared)

---

### RequestLog
| Field | Type | Notes |
|---|---|---|
| `id` | String (cuid) | Part of composite PK |
| `timestamp` | DateTime | Part of composite PK (TimescaleDB requirement) |
| `projectId` | String | FK → Project (cascade delete) |
| `method` | String | HTTP verb |
| `route` | String | Matched route pattern (e.g. `/users/:id`) |
| `statusCode` | Int | |
| `responseTime` | Int | Milliseconds |

**PK**: `[id, timestamp]` — composite PK required because TimescaleDB needs the partition column in every unique index.
**Feature**: Pulse Observe — ingestion

---

### ErrorEvent
| Field | Type | Notes |
|---|---|---|
| `id` | String (cuid) | PK |
| `projectId` | String | FK → Project (cascade delete) |
| `message` | String | e.g. `HTTP 500` |
| `stack` | String? | Optional stack trace |
| `route` | String | |
| `statusCode` | Int | |
| `count` | Int | Incremented on each occurrence |
| `firstSeen` | DateTime | |
| `lastSeen` | DateTime | |
| `resolved` | Boolean | Default false |
| `resolvedAt` | DateTime? | |

**Unique**: `[projectId, route, statusCode]` — errors are grouped, not stored per-request
**Feature**: Pulse Observe — error tracking

---

### UptimeCheck
| Field | Type | Notes |
|---|---|---|
| `id` | String (cuid) | PK |
| `projectId` | String | FK → Project (cascade delete) |
| `url` | String | Target URL pinged |
| `status` | String | `'up'` or `'down'` |
| `responseTime` | Int? | Milliseconds, null on timeout/error |
| `checkedAt` | DateTime | |

**Feature**: Pulse Observe — uptime monitoring

---

### Alert
| Field | Type | Notes |
|---|---|---|
| `id` | String (cuid) | PK |
| `projectId` | String | FK → Project (cascade delete) |
| `type` | String | `uptime` / `error_rate` / `response_time` / `rate_limit_spike` |
| `threshold` | Float | Meaning depends on type |
| `channel` | String | `email` or `slack` |
| `destination` | String | Email address or Slack webhook URL |
| `active` | Boolean | Default true |
| `url` | String? | Required for uptime alerts |
| `route` | String? | Optional route filter for response_time alerts |

**Relations**: `AlertEvent[]`
**Feature**: Shared — alert rule definition

---

### AlertEvent
| Field | Type | Notes |
|---|---|---|
| `id` | String (cuid) | PK |
| `alertId` | String | FK → Alert (cascade delete) |
| `projectId` | String | FK → Project (cascade delete) |
| `type` | String | Alert type at time of firing |
| `triggeredValue` | Float | Actual measured value |
| `threshold` | Float | Threshold at time of firing |
| `message` | String | Human-readable description |
| `channel` | String | Delivery channel |
| `destination` | String | Where it was sent |
| `sentAt` | DateTime | Default now() |

**Feature**: Shared — fired alert record

---

### RateLimitRule
| Field | Type | Notes |
|---|---|---|
| `id` | String (cuid) | PK |
| `projectId` | String | FK → Project (cascade delete) |
| `name` | String | Display name |
| `pathPattern` | String | Glob pattern (e.g. `/api/**`) |
| `limitKey` | String | `ip` / `apiKey` / `userId` / `global` |
| `limitKeyHeader` | String? | Custom header name for apiKey mode |
| `limitCount` | Int | Max requests per window |
| `windowSecs` | Int | Window size in seconds |
| `action` | String | `block` or `log_only` |
| `priority` | Int | Higher = matched first; default 0 |
| `enabled` | Boolean | Default true |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | `@updatedAt` |

**Index**: `[projectId, enabled]`
**Feature**: Pulse Rate Limiter — rule definition

---

### RateLimitEvent
| Field | Type | Notes |
|---|---|---|
| `id` | String (cuid) | Part of composite PK |
| `timestamp` | DateTime | Part of composite PK (TimescaleDB requirement); default now() |
| `projectId` | String | FK → Project (cascade delete) |
| `ruleId` | String | Which rule was matched |
| `limitKey` | String | The resolved key value (IP, hashed apiKey, userId, or 'global') |
| `path` | String | Matched request path |
| `action` | String | `blocked` or `logged` |

**PK**: `[id, timestamp]`
**Indexes**: `[projectId, timestamp]`, `[ruleId, timestamp]`
**Feature**: Pulse Rate Limiter — event log

---

## 3. Feature Map

### Pulse Observe

#### Request Ingestion
- **API route**: `POST /ingest` — `apps/api/src/routes/ingest.ts`
- **Worker processor**: `apps/worker/src/processors/ingest.processor.ts` (`processIngest`)
- **Dashboard page**: `apps/web/app/dashboard/page.tsx` (StatsCards + LogTable)
- **Data flow**: SDK patches `res.end()` → batches `IngestEvent` → POSTs to `/ingest` → validates API key + plan limit → enqueues to BullMQ `ingest` queue → worker writes `RequestLog`, upserts `ErrorEvent` if `statusCode >= 400`
- **Status**: Working

#### Live Logs
- **API route**: `GET /api/projects/:id/logs` (Next.js proxy → apps/api)
- **Dashboard page**: `apps/web/app/dashboard/logs/page.tsx`
- **Hook**: `apps/web/hooks/useLiveLogs.ts` — `useLiveLogs()`, polls every **3 seconds**, max buffer 500 rows
- **Data flow**: Hook polls `/api/projects/:id/logs?since=<lastTimestamp>` → Next.js API proxy → apps/api → `RequestLog` query
- **Status**: Working

#### Analytics (Volume / Latency / Top Routes)
- **API routes**: `GET /projects/:id/analytics/volume`, `/latency`, `/top-routes` — `apps/api/src/routes/analytics.ts`
- **Dashboard page**: `apps/web/app/dashboard/analytics/page.tsx`
- **Hooks**: `useVolumeData()`, `useLatencyData()`, `useTopRoutes()` in `apps/web/hooks/useAnalytics.ts` — refresh every **60 seconds**
- **Charts**: `VolumeChart`, `LatencyChart`, `ErrorRateChart` in `apps/web/components/charts/`
- **Data flow**: Hook fetches from Next.js API proxy → apps/api raw SQL queries on `RequestLog` using epoch-floor bucketing (plain PostgreSQL, no TimescaleDB extension required)
- **Status**: Working

#### Error Tracking
- **API routes**: `GET /projects/:id/analytics/errors`, `PATCH /projects/:id/errors/:errorId/resolve`, `PATCH /projects/:id/errors/:errorId/unresolve` — `apps/api/src/routes/analytics.ts`
- **Dashboard page**: `apps/web/app/dashboard/errors/page.tsx`
- **Hook**: `useErrorList()` in `apps/web/hooks/useAnalytics.ts` — refresh every **60 seconds**
- **Data flow**: Ingest worker upserts `ErrorEvent` on every `statusCode >= 400` → API reads `ErrorEvent` table directly → dashboard renders open/resolved tabs
- **Status**: Partial — see Known Issues §8 (Mark as Resolved not working)

#### Uptime Monitoring
- **API route**: `GET /projects/:id/uptime` — `apps/api/src/routes/alerts.ts`
- **Worker processor**: `apps/worker/src/processors/uptime.processor.ts` (`processUptimeCheck`)
- **Dashboard page**: `apps/web/app/dashboard/uptime/page.tsx`
- **Hook**: `useUptime()` in `apps/web/hooks/useUptime.ts` — refresh every **60 seconds**
- **Data flow**: Worker pings every active uptime Alert's `url` every 60s → writes `UptimeCheck` → calls `evaluateUptimeAlerts()` → API aggregates last 100 checks for dashboard
- **Status**: Working

#### Alert Management
- **API routes**: `GET/POST /projects/:id/alerts`, `PATCH/DELETE /projects/:id/alerts/:alertId`, `GET /projects/:id/alerts/history`, `POST /projects/:id/alerts/:alertId/test` — `apps/api/src/routes/alerts.ts`
- **Dashboard page**: `apps/web/app/dashboard/alerts/page.tsx`
- **Hooks**: `useAlerts()`, `useAlertHistory()` in `apps/web/hooks/useAlerts.ts` — on-demand (no auto-refresh)
- **Data flow**: User creates Alert via dashboard → API writes Alert row → worker evaluators check Alert conditions on each tick → `dispatch()` in notifications.ts sends email/Slack + writes AlertEvent
- **Status**: Working

---

### Pulse Rate Limiter

#### Hot-Path Check
- **Rate-limiter route**: `POST /v1/check` — `apps/rate-limiter/src/routes/check.ts` (`checkRoutes`)
- **SDK middleware**: `apps/sdk/src/middleware/rate-limit-express.ts` (`rateLimit`) / `rate-limit-fastify.ts` (`rateLimitPlugin`)
- **Data flow**: SDK middleware intercepts request → extracts IP/path/headers → POSTs to `/v1/check` → rate-limiter validates API key (Redis cache → DB), loads rules (Redis cache → DB), runs `incrementCounter()` atomically via Redis INCR + EXPIREAT → returns `{allowed, rule, retryAfter}` → SDK returns 429 with Retry-After if blocked; enqueues event fire-and-forget to BullMQ
- **Status**: Working — **but see Known Issues §8 (SDK was historically not enforcing; current code does enforce)**

#### Rules Management
- **Rate-limiter routes**: `GET/POST /v1/rules/:projectId`, `PATCH/DELETE /v1/rules/:ruleId`, `PUT /v1/rules/:ruleId/toggle` — `apps/rate-limiter/src/routes/rules.ts` (`rulesRoutes`)
- **Next.js proxy routes**: `apps/web/app/api/rate-limiter/[projectId]/rules/route.ts`, `apps/web/app/api/rate-limiter/rules/[ruleId]/route.ts`, `apps/web/app/api/rate-limiter/rules/[ruleId]/toggle/route.ts`
- **Dashboard pages**: `apps/web/app/dashboard/rate-limiter/rules/page.tsx`, `apps/web/app/dashboard/rate-limiter/rules/new/page.tsx`
- **Hook**: `useRules()`, `useRuleToggle()`, `useCreateRule()` in `apps/web/hooks/useRateLimiter.ts` — on-demand
- **Data flow**: UI calls Next.js API proxy → proxy adds Bearer `RATE_LIMITER_INTERNAL_TOKEN` → rate-limiter writes to DB → invalidates Redis rules cache so `/v1/check` sees updated rules within ≤ 30s
- **Status**: Working

#### Rate Limit Events (Live Feed)
- **Rate-limiter analytics route**: `GET /v1/analytics/:projectId/events` — `apps/rate-limiter/src/routes/analytics.ts`
- **Next.js proxy**: `apps/web/app/api/rate-limiter/[projectId]/events/route.ts`
- **Dashboard page**: `apps/web/app/dashboard/rate-limiter/events/page.tsx`
- **Data flow**: Check handler enqueues to BullMQ `rate-limit-events` queue (fire-and-forget) → worker writes `RateLimitEvent` → dashboard polls events endpoint every 3s
- **Status**: Working

#### Rate Limiter Overview / Analytics
- **Rate-limiter routes**: `GET /v1/analytics/:projectId/stats`, `/hit-rate`, `/top-offenders` — `apps/rate-limiter/src/routes/analytics.ts`
- **Next.js proxies**: `apps/web/app/api/rate-limiter/[projectId]/stats/route.ts`, `/hit-rate/route.ts`, `/top-offenders/route.ts`
- **Dashboard page**: `apps/web/app/dashboard/rate-limiter/page.tsx` (`RateLimiterOverviewPage`)
- **Hooks**: `useHitRate()`, `useTopOffenders()` in `apps/web/hooks/useRateLimitAnalytics.ts` — refresh every **60 seconds**
- **Chart**: `RateLimitHitRateChart` in `apps/web/components/charts/RateLimitHitRateChart.tsx`
- **Data flow**: Rate-limiter queries `RateLimitEvent` table with raw SQL → Next.js proxy → hook → chart
- **Status**: Working

---

## 4. Alert System

### `error_rate`
| Property | Value |
|---|---|
| Processor that triggers evaluation | `observe-alerts.processor.ts` (`processObserveAlertsCheck`) — repeatable BullMQ job every 60s |
| Evaluator function | `evaluateErrorRate()` in `apps/worker/src/lib/alert-evaluator.ts` |
| Window | 5 minutes (`ERROR_RATE_WINDOW_MS = 5 * 60 * 1000`) |
| Debounce TTL | 600 seconds |
| Behaviour | Threshold check — queries `RequestLog` for error % in last 5min; fires if `errorRate > threshold`; no state tracking, fires on every tick if condition persists and debounce has expired |

### `response_time`
| Property | Value |
|---|---|
| Processor that triggers evaluation | `observe-alerts.processor.ts` (`processObserveAlertsCheck`) — every 60s |
| Evaluator function | `evaluateResponseTime()` in `apps/worker/src/lib/alert-evaluator.ts` |
| Window | 5 minutes (`RESPONSE_TIME_WINDOW_MS = 5 * 60 * 1000`) |
| Debounce TTL | 600 seconds |
| Behaviour | Threshold check — computes `percentile_cont(0.99)` on `RequestLog.responseTime` in last 5min; fires if `p99 > threshold`; supports optional `alert.route` filter |

### `uptime`
| Property | Value |
|---|---|
| Processor that triggers evaluation | `uptime.processor.ts` (`processUptimeCheck`) — every 60s, calls `evaluateUptimeAlerts()` after each ping |
| Evaluator function | `evaluateUptime()` in `apps/worker/src/lib/alert-evaluator.ts` |
| State key | `alert:uptime:state:${alertId}` in Redis (TTL 3600s) |
| Debounce TTL | 300 seconds |
| Behaviour | **State transition** — fires when last check is `down` AND previous Redis state was `up` or `null` (first-ever check). Does NOT fire on repeated `down` checks. On recovery (up + prev=down): clears the debounce key so next outage fires fresh. |

### `rate_limit_spike`
| Property | Value |
|---|---|
| Processor that triggers evaluation | `rate-limit-event.processor.ts` (`processRateLimitEvent`) — called after every event write, fire-and-forget |
| Evaluator function | `evaluateRateLimitAlerts()` → `evaluateRateLimitSpikeAlert()` → `evaluateBlockSpike()` in `apps/worker/src/lib/alert-evaluator.ts` |
| Window | 5 minutes (`RATE_LIMIT_SPIKE_WINDOW_MS = 5 * 60 * 1000`) |
| Debounce TTL | 300 seconds |
| Evaluation lock | `rl:eval:lock:${projectId}` (Redis NX, TTL 5s) — prevents concurrent evaluations for the same project |
| Behaviour | Threshold check — counts blocked events in last 5min; fires if `blockCount > threshold`; debounce key is `alert:debounce:${alertId}:spike` (distinct from plain `alertId` to avoid collision with state key) |

---

## 5. Background Workers

### Ingest Worker
| Property | Value |
|---|---|
| File | `apps/worker/src/processors/ingest.processor.ts` |
| Queue name | `ingest` |
| Concurrency | 10 |
| What it does | Reads `IngestJobData` (projectId, method, route, statusCode, responseTime, timestamp, stack?); writes one `RequestLog` row; if `statusCode >= 400`, upserts `ErrorEvent` incrementing `count` and updating `lastSeen` |
| After processing | Nothing (terminal) |

### Uptime Worker
| Property | Value |
|---|---|
| File | `apps/worker/src/processors/uptime.processor.ts` |
| Queue name | `uptime` (repeatable, every 60,000 ms) |
| Concurrency | 1 |
| What it does | Finds all active `Alert` rows with `type=uptime` and non-null `url`; pings each URL with a 10s timeout (GET with `X-Pulse-Skip-Log: true` header); writes one `UptimeCheck` row per URL |
| After processing | Calls `evaluateUptimeAlerts(projectId)` for each pinged URL |

### Observe-Alerts Worker
| Property | Value |
|---|---|
| File | `apps/worker/src/processors/observe-alerts.processor.ts` |
| Queue name | `observe-alerts` (repeatable, every 60,000 ms) |
| Concurrency | 1 |
| What it does | Finds all distinct `projectId` values with active `error_rate` or `response_time` alerts; calls `evaluateObserveAlerts(projectId)` for each |
| After processing | `evaluateObserveAlerts()` calls `evaluateSingleAlert()` for each matching alert |

### Rate-Limit-Event Worker
| Property | Value |
|---|---|
| File | `apps/worker/src/processors/rate-limit-event.processor.ts` |
| Queue name | `rate-limit-events` |
| Concurrency | 10 |
| What it does | Reads `RateLimitEventJobData`; calls `prisma.rateLimitEvent.createMany()` with one row |
| After processing | Fire-and-forget: calls `evaluateRateLimitAlerts(projectId)` (errors are caught and logged, never thrown) |

---

## 6. Redis Key Schema

| Key pattern | What it stores | TTL | File that reads/writes |
|---|---|---|---|
| `rl:${projectId}:${ruleId}:${keyValue}:${windowSlot}` | Integer counter (fixed-window request count) | `windowSecs` — set via `EXPIREAT` to exact slot-end Unix timestamp | `apps/rate-limiter/src/lib/counter.ts` (`incrementCounter`, `buildCounterKey`) |
| `rl:rules:${projectId}` | JSON array of `RateLimitRuleRecord[]` (enabled rules only) | `RATE_LIMITER_RULE_CACHE_TTL` (default 30s) | `apps/rate-limiter/src/lib/rule-cache.ts` (`getRulesForProject`, `invalidateRulesCache`) |
| `rl:project:${sha256(apiKey)}` | JSON `{ id: string }` — project ID looked up from API key | 60 seconds | `apps/rate-limiter/src/middleware/auth.ts` (`resolveProject`) |
| `alert:uptime:state:${alertId}` | String `'up'` or `'down'` — last known uptime status | 3600 seconds | `apps/worker/src/lib/alert-evaluator.ts` (`evaluateUptime`) |
| `alert:debounce:${alertId}` | String `'1'` — presence means alert is debounced | 300s (uptime, rate_limit_spike) or 600s (error_rate, response_time) | `apps/worker/src/lib/alert-evaluator.ts` (`fireAlert`) |
| `alert:debounce:${alertId}:spike` | String `'1'` — debounce key specifically for rate_limit_spike (uses `:spike` suffix) | 300 seconds | `apps/worker/src/lib/alert-evaluator.ts` (`evaluateBlockSpike` via `fireAlert`) |
| `rl:eval:lock:${projectId}` | String `'1'` — mutex preventing concurrent rate-limit alert evaluation | 5 seconds | `apps/worker/src/lib/alert-evaluator.ts` (`evaluateRateLimitAlerts`) |

---

## 7. SDK Middleware

### `pulse()` (Express) / `pulsePlugin()` (Fastify)

**Step by step**:
1. Creates a `PulseClient` instance (`packages/sdk/src/core/client.ts`) with `apiKey`, `host` (default: `https://api.pulse.dev`), `timeout` (default 5000ms), `debug`
2. Calls `setClient(client)` so `captureError()` can reference it
3. Creates a `BatchBuffer` (`packages/sdk/src/core/buffer.ts`) with `onFlush` wired to `client.send(events)`
4. Calls `buffer.start()` (auto-flush on interval / size threshold)
5. Registers `SIGTERM` / `SIGINT` handlers to drain the buffer gracefully
6. **Express**: patches `res.end()` to measure `responseTime = Date.now() - startTime` and capture `method`, `route` (prefers `req.route.path` over raw `req.path`), `statusCode`, `timestamp`
7. **Fastify**: hooks `onRequest` (records start time on `request.pulseStartTime`) and `onResponse` (captures metrics)
8. Skips any request with header `X-Pulse-Skip-Log: true`, any method in `ignoreMethods`, or any path starting with a prefix in `ignoreRoutes`
9. Adds `IngestEvent` to buffer; `PulseClient.send()` POSTs `{ events: IngestEvent[] }` to `{host}/ingest` with `Authorization: Bearer {apiKey}`
10. All send errors are silently swallowed — never throws, never rejects

**Fail-open behaviour**: Any error in middleware is caught; `next()` is always called regardless

---

### `rateLimit()` (Express) / `rateLimitPlugin()` (Fastify)

**Step by step**:
1. Creates a `RateLimiter` instance (`packages/sdk/src/rate-limit.ts`)
2. If `options.rules === 'auto'`: fetches enabled rules from `${RATE_LIMITER_URL}/v1/rules/${PULSE_PROJECT_ID}` with `Authorization: Bearer ${RATE_LIMITER_INTERNAL_TOKEN}`; refreshes every 30s; stale rules are retained on fetch failure
3. If `options.rules` is an array: uses those rules as the cached rule set (no network fetch)
4. Registers `SIGTERM` / `SIGINT` cleanup (calls `limiter.destroy()` to clear refresh interval)
5. **Per request**:
   - a. Extracts IP from `x-forwarded-for` (first value) or `req.socket.remoteAddress` or `'0.0.0.0'`
   - b. **Local pre-filter**: if `cachedRules.length > 0` and no rule's glob matches the request path → returns `{ allowed: true }` without a network call
   - c. POSTs to `${RATE_LIMITER_URL}/v1/check` with `{ projectId, apiKey, path, method, ip, headers }` (timeout: `checkTimeout` ms, default 100ms)
   - d. On `allowed: false`: sets `Retry-After`, calls `onLimited` callback if provided, then:
     - **Express** (`rate-limit-express.ts`): `res.status(429).json({ error: 'Too Many Requests', retryAfter })` and returns — does NOT call `next()`
     - **Fastify** (`rate-limit-fastify.ts`): UNCLEAR — `rateLimitPlugin` file was not read; behaviour mirrors Express pattern based on SDK structure
   - e. On `allowed: true`: calls `next()`
   - **Fastify** (`rate-limit-fastify.ts`): runs inside an `onRequest` hook (not a preHandler). IP extraction, header forwarding, and `limiter.check()` call are identical to Express. On `allowed: false`: sets headers then calls `await reply.status(429).send({ error: 'Too Many Requests', retryAfter })` — Fastify's `send()` in an `onRequest` hook short-circuits the request lifecycle without calling any further handlers. On `allowed: true`: hook returns normally and Fastify proceeds to the next hook/handler.
6. Any exception or timeout → fail open (allow request); the entire hook body is wrapped in `try/catch` — errors are swallowed and the request proceeds

**Fail-open behaviour**: Hardcoded default `failOpen = true`. If `failOpen = false`, a console warning is printed. On network error, timeout, or `/v1/check` non-200: returns `{ allowed: true }` when `failOpen = true`

**Headers set on every response where a rule was evaluated**:
- `{prefix}-Limit` (default `X-RateLimit-Limit`)
- `{prefix}-Remaining` (default `X-RateLimit-Remaining`)
- `{prefix}-Reset` (default `X-RateLimit-Reset`)
- `Retry-After` — only when `allowed: false`

---

## 8. Known Issues

### Issue 1 — Rate Limiter is observing only, not enforcing — **FIXED**

**Status**: FIXED

**Root cause**: The SDK middleware had two problems:
1. **Express** (`packages/sdk/src/middleware/rate-limit-express.ts`): The `if (outcome.meta)` header block ran before the `!outcome.allowed` check, so blocked responses reported non-zero `Remaining`. `Retry-After` was only set when `retryAfter !== undefined` (missing `?? 60` fallback). The header-setting and blocked-path logic was restructured: now `!outcome.allowed` is checked first, sets all four RFC 6585 headers unconditionally (with `?? 60`/`?? 0` fallbacks), sends 429, and returns. Informational headers for allowed requests are set after the early-return block.
2. **Fastify** (`packages/sdk/src/middleware/rate-limit-fastify.ts`): Same header ordering issue plus no `return` after `reply.send()` — the `onRequest` hook did not explicitly terminate after sending 429. Fixed with `reply.headers({})` bulk set and `return` after `reply.status(429).send()`.

**Files changed**:
- `packages/sdk/src/middleware/rate-limit-express.ts`
- `packages/sdk/src/middleware/rate-limit-fastify.ts`

---

### Issue 2 — Mark as Resolved not working on Errors page — **FIXED**

**Status**: FIXED

**Root cause**: Frontend response handling — `handleResolve()` (and `handleUnresolve()`) in `apps/web/app/dashboard/errors/page.tsx` never checked `res.ok` on the PATCH response. When the PATCH failed for any reason, `onResolved()` (→ `refetch()`) was called unconditionally, causing a refetch that returned the same unchanged data. The button appeared to do nothing.

Diagnosis confirmed:
- Proxy route (`apps/web/app/api/projects/[id]/errors/[errorId]/resolve/route.ts`): correct, forwards PATCH with Clerk JWT ✓
- Frontend URL/method: correct (`/api/projects/${projectId}/errors/${error.id}/resolve`, PATCH) ✓
- Refetch: `onResolved()` → `refetch()` IS called ✓
- View filter: `&view=${view}` IS passed in `useErrorList` URL ✓

**Fix**: Added `const res = await fetch(...)` and `if (!res.ok) return` before `onResolved()` in both `handleResolve()` and `handleUnresolve()`.

**File changed**: `apps/web/app/dashboard/errors/page.tsx`

---

### Issue 3 — Mark as Resolved API-layer re-investigation — **NO BUG FOUND**

**Status**: NO BUG FOUND in `apps/api/src/routes/analytics.ts`

**Investigation**: After Issue 2 was fixed on the frontend, the symptom was re-reported and the API layer was investigated as the suspect.

Verified in `apps/api/src/routes/analytics.ts`:
- PATCH `/projects/:projectId/errors/:errorId/resolve` (lines 252-269): correctly calls `prisma.errorEvent.update({ where: { id: errorId }, data: { resolved: true, resolvedAt: new Date() } })` and returns the updated record ✓
- GET `/projects/:projectId/analytics/errors` (lines 195-249): reads `qp['view']` (defaults to 'open'), builds `resolvedFilter` (`{ resolved: false }` for open, `{ resolved: true }` for resolved, `{}` for all) and spreads into `baseWhere = { projectId, lastSeen: { gte: since }, ...resolvedFilter }` which is passed to `prisma.errorEvent.findMany({ where: baseWhere })` ✓

Schema (`packages/db/prisma/schema.prisma`) has `resolved Boolean @default(false)` and `resolvedAt DateTime?` on `ErrorEvent`. Migration `20260521122058_fix_pending_items` adds both columns to the DB.

**Conclusion**: The handler logic is correct. If the symptom recurs, the likely cause is operational — Prisma client not regenerated after the schema migration (`npx prisma generate`), causing the runtime client to silently drop the unknown `resolved` field. This is not a code-level fix; the source file was left unchanged.

---

### Issue 4 — `/v1/check` returns 429 status; SDK treats it as an error — **FIXED**

**Status**: FIXED

**Root cause**: Two coupled defects in the SDK ↔ rate-limiter contract:
1. `apps/rate-limiter/src/routes/check.ts` responded with HTTP `429` when blocking. The SDK (`packages/sdk/src/rate-limit.ts`) treats any non-2xx as a transport error and returns `{ allowed: this._failOpen }` — so on `failOpen: true` (the hardcoded default per Non-Negotiable #1) blocks turned into allows, and the developer's route ran.
2. `apps/rate-limiter/src/env.ts` defaulted `RATE_LIMITER_CHECK_TIMEOUT_MS` to `'10'` ms. The `Promise.race` in `checkRoutes` aborted runCheck before Redis INCR + EXPIREAT could complete on typical infrastructure, returning `{ allowed: true }` (fail open) even for requests that exceeded the limit.

**Fix**:
- `apps/rate-limiter/src/routes/check.ts`: removed `reply.status(429)` on the blocked path. The endpoint now always responds with status 200; the SDK reads `json.allowed` from the body to make the block decision (and forwards a 429 to the end user from `rate-limit-express.ts`).
- `apps/rate-limiter/src/env.ts`: bumped `RATE_LIMITER_CHECK_TIMEOUT_MS` default from `'10'` to `'1000'` so Redis round trips and DB cache-miss fallbacks complete within the inner timeout.

**Files changed**:
- `apps/rate-limiter/src/routes/check.ts`
- `apps/rate-limiter/src/env.ts`

---

### Issue 5 — Uptime pings create phantom rate-limit events — **FIXED**

**Status**: FIXED

**Root cause**: The Pulse Observe middleware (`packages/sdk/src/middleware/express.ts` line 37) honours `X-Pulse-Skip-Log: true` and short-circuits via `next()` so the uptime worker's 60-second pings never get ingested. The Rate Limiter middleware (`packages/sdk/src/middleware/rate-limit-express.ts`) had no equivalent check, so every uptime ping that traversed a developer's rate-limited path called `/v1/check`, incremented the counter, and enqueued a `RateLimitEvent` — producing entries on a 60-second cadence with zero real user traffic.

**Fix**: Added the same `if (req.headers['x-pulse-skip-log'] === 'true') { next(); return }` early return at the top of the Express rate-limit middleware, mirroring the Observe middleware. The uptime processor (`apps/worker/src/processors/uptime.processor.ts` line 45) was confirmed to send the header and was not modified.

**File changed**: `packages/sdk/src/middleware/rate-limit-express.ts`

---

## 9. Environment Variables

### `apps/api` (port 3001)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection URL |
| `REDIS_URL` | Yes | — | Redis connection URL |
| `PORT` | No | `3001` | API server listen port |
| `API_KEY_SECRET` | Yes (min 32 chars) | — | Secret for generating project API keys |
| `CLERK_SECRET_KEY` | Yes | — | Clerk backend SDK authentication key |
| `CLERK_WEBHOOK_SECRET` | Yes | — | Svix signature verification for Clerk webhooks |
| `RESEND_API_KEY` | No | — | Resend email API key; omitting disables email alert delivery |
| `RESEND_FROM_EMAIL` | No | `alerts@pulse.dev` | Sender address for alert emails |
| `NODE_ENV` | No | `development` | |

### `apps/rate-limiter` (port 3002)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection URL |
| `REDIS_URL` | Yes | — | Redis connection URL (fallback if `RATE_LIMITER_REDIS_URL` not set) |
| `RATE_LIMITER_PORT` | No | `3002` | Rate-limiter service listen port |
| `RATE_LIMITER_INTERNAL_TOKEN` | Yes (min 32 chars) | — | Bearer token required on all `/v1/rules` and `/v1/analytics` routes; set by the Next.js web app proxy |
| `RATE_LIMITER_REDIS_URL` | No | — | Override Redis URL for rate-limiter (defaults to `REDIS_URL`) |
| `RATE_LIMITER_RULE_CACHE_TTL` | No | `30` | Seconds to cache project rules in Redis |
| `RATE_LIMITER_CHECK_TIMEOUT_MS` | No | `10` | Milliseconds before `/v1/check` aborts and fails open |
| `NODE_ENV` | No | `development` | |

### `apps/worker` (no HTTP port)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection URL |
| `REDIS_URL` | Yes | — | Redis connection URL (also used for BullMQ) |
| `RESEND_API_KEY` | No | — | Resend email API key for alert notifications |
| `RESEND_FROM_EMAIL` | No | `alerts@pulse.dev` | Sender address |
| `NODE_ENV` | No | `development` | |

### `packages/sdk` (used in customer's application)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PULSE_API_KEY` | Yes (for `pulse()`) | — | Project API key; passed to `pulse({ apiKey })` or set as env var |
| `PULSE_HOST` | No | `https://api.pulse.dev` | URL of the `apps/api` server |
| `PULSE_PROJECT_ID` | Yes (for `rateLimit()`) | — | Project ID for `/v1/check` calls |
| `RATE_LIMITER_URL` | Yes (for `rateLimit()`) | — | URL of the `apps/rate-limiter` service |
| `RATE_LIMITER_INTERNAL_TOKEN` | Yes (for `rules: 'auto'`) | — | Bearer token for fetching rules from rate-limiter service |

### `apps/web` (Next.js, port 3000)

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Public dashboard URL; embedded in alert email links (read in `notifications.ts` via `process.env['NEXT_PUBLIC_APP_URL']`) |
| Clerk environment variables | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, etc. — standard Clerk Next.js setup |
| `RATE_LIMITER_URL` | URL of rate-limiter service — used by Next.js API proxy routes to forward rule/analytics requests |
| `RATE_LIMITER_INTERNAL_TOKEN` | Added as Bearer token by the Next.js proxy to authenticate with the rate-limiter service |

---

## 10. Non-Negotiables

These rules must never be violated in any future edit to the Rate Limiter feature:

1. **Fail open** — if `/v1/check` times out, is unreachable, or returns a non-200, the SDK must allow the request through. `failOpen: false` must never be set as a default.

2. **No DB reads on the `/v1/check` hot path** — the check endpoint must only read from Redis (counter + rules cache + project cache). DB reads happen only on cache miss and must be followed immediately by a cache populate. No ORM queries outside of cache-miss fallback.

3. **Atomic Redis INCR only** — rate counters must be incremented with `INCR` (atomic). No read-modify-write patterns. The pipeline is `INCR key` → `EXPIREAT key resetAt`. This is the only permitted counter update pattern.

4. **Key isolation by projectId** — all Redis keys for rate limiting are prefixed with `rl:${projectId}:...`. No cross-project key sharing.

5. **No PII in Redis** — `limitKey` for `apiKey` mode stores a 32-char hex SHA-256 hash, not the raw key. `limitKey` for `userId` stores the opaque user ID from `x-user-id` header as-is. IP addresses are stored as-is (not PII by policy). Emails, passwords, and other sensitive fields must never appear in any Redis key or value.

6. **Never touch Observe when editing Rate Limiter** — the ingest pipeline (`apps/api/src/routes/ingest.ts`, `apps/worker/src/processors/ingest.processor.ts`), analytics routes (`apps/api/src/routes/analytics.ts`), and all Observe dashboard pages are completely separate from Rate Limiter. Any Rate Limiter edit must not touch these files.

7. **Never touch Rate Limiter when editing Observe** — `apps/rate-limiter/`, `apps/web/app/api/rate-limiter/`, `apps/web/app/dashboard/rate-limiter/`, and `packages/sdk/src/rate-limit.ts` must not be modified during Observe feature work.
