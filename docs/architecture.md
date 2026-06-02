# Pulse — Complete Architecture Map

> Generated 2026-05-19. All file paths, field names, route paths, queue names, and env vars are sourced directly from the codebase. Nothing is invented.

---

## 1. Monorepo Structure

```
pulse/
├── apps/
│   ├── api/                          Fastify ingestion + REST API server (port 3001)
│   │   └── src/
│   │       ├── index.ts              Server bootstrap, plugin registration, listen
│   │       ├── env.ts                Zod-validated env schema
│   │       ├── env-loader.ts         dotenv loader (reads root .env)
│   │       ├── lib/
│   │       │   ├── api-key.ts        generateApiKey / hashApiKey / getApiKeyPrefix
│   │       │   ├── auth.ts           verifyClerkJwt helper
│   │       │   ├── plan-limits.ts    isOverPlanLimit (monthly count check)
│   │       │   ├── queue.ts          BullMQ Queue instance ('ingest')
│   │       │   └── redis.ts          IORedis singleton
│   │       ├── plugins/
│   │       │   ├── cors.ts           @fastify/cors (dev: allow all; prod: deny)
│   │       │   ├── helmet.ts         @fastify/helmet security headers
│   │       │   └── rate-limit.ts     @fastify/rate-limit (100 req / 10 s, Redis-backed)
│   │       └── routes/
│   │           ├── health.ts         GET /health
│   │           ├── ingest.ts         POST /ingest (API-key auth)
│   │           ├── projects.ts       POST /projects, GET /projects/:id/stats, GET /projects/:id/logs, POST /projects/:id/reveal-key
│   │           ├── analytics.ts      GET /projects/:id/analytics/* (volume, latency, top-routes, errors)
│   │           ├── alerts.ts         CRUD /projects/:id/alerts, GET /projects/:id/alerts/history, GET /projects/:id/uptime
│   │           └── webhooks/
│   │               └── clerk.ts      POST /webhooks/clerk (Svix signature verification)
│   │
│   ├── worker/                       BullMQ job processor (no HTTP port)
│   │   └── src/
│   │       ├── index.ts              Worker bootstrap; registers ingest + uptime workers
│   │       ├── env.ts                Zod-validated env schema
│   │       ├── env-loader.ts         dotenv loader
│   │       ├── lib/
│   │       │   ├── alert-evaluator.ts evaluateAlerts() — queries DB, applies thresholds
│   │       │   ├── notifications.ts   dispatch() — sends email (Resend) or Slack webhook
│   │       │   └── redis.ts           IORedis singleton (shared with alert debounce)
│   │       └── processors/
│   │           ├── ingest.processor.ts  Writes RequestLog, upserts ErrorEvent, fires alerts
│   │           └── uptime.processor.ts  Pings URLs, writes UptimeCheck, fires alerts
│   │
│   └── web/                          Next.js 14 App Router dashboard (port 3000)
│       ├── middleware.ts             Clerk auth gate for /dashboard/**
│       ├── next.config.js            Loads root .env; transpiles @pulse/types, @pulse/db
│       ├── app/
│       │   ├── layout.tsx            Root layout: ClerkProvider, Inter font
│       │   ├── page.tsx              Landing page / redirect to /dashboard if signed in
│       │   ├── globals.css           Tailwind CSS base + custom animations (flash-new)
│       │   ├── (auth)/
│       │   │   ├── sign-in/[[...sign-in]]/page.tsx   Clerk SignIn component
│       │   │   └── sign-up/[[...sign-up]]/page.tsx   Clerk SignUp component
│       │   ├── dashboard/
│       │   │   ├── layout.tsx        Fetches user+projects from DB; renders Sidebar
│       │   │   ├── page.tsx          Overview: StatsCards + LogTable + project modals
│       │   │   ├── logs/page.tsx     Live Logs: real-time polling table
│       │   │   ├── analytics/page.tsx Analytics: volume, latency, error rate, top routes
│       │   │   ├── errors/page.tsx   Error groups list with stack trace expand
│       │   │   ├── alerts/page.tsx   Alert CRUD (3-step form) + history table
│       │   │   └── uptime/page.tsx   Uptime status + hourly bar chart
│       │   └── api/
│       │       ├── projects/
│       │       │   ├── route.ts                       GET /api/projects
│       │       │   └── [id]/
│       │       │       ├── stats/route.ts             GET /api/projects/[id]/stats
│       │       │       ├── logs/route.ts              GET /api/projects/[id]/logs
│       │       │       ├── reveal-key/route.ts        POST /api/projects/[id]/reveal-key
│       │       │       ├── analytics/
│       │       │       │   ├── volume/route.ts        GET → proxy to API
│       │       │       │   ├── latency/route.ts       GET → proxy to API
│       │       │       │   ├── top-routes/route.ts    GET → proxy to API
│       │       │       │   └── errors/route.ts        GET → proxy to API
│       │       │       ├── alerts/
│       │       │       │   ├── route.ts               GET / POST → proxy to API
│       │       │       │   ├── [alertId]/route.ts     PATCH / DELETE → proxy to API
│       │       │       │   └── history/route.ts       GET → proxy to API
│       │       │       └── uptime/route.ts            GET → proxy to API
│       ├── components/
│       │   ├── Sidebar.tsx           Navigation sidebar with project selector
│       │   ├── StatsCards.tsx        4-metric summary cards (total req, 24h req, error%, avg latency)
│       │   ├── LogTable.tsx          Paginated request log table with status filter
│       │   ├── CreateProjectModal.tsx 2-step modal: name form → one-time API key reveal
│       │   ├── RegenerateKeyModal.tsx Confirmation + API key regeneration reveal
│       │   ├── TimeRangeSelector.tsx 1h / 6h / 24h / 7d tab selector
│       │   ├── TopRoutesTable.tsx    Ranked table of top 10 routes with latency/error stats
│       │   └── charts/
│       │       ├── VolumeChart.tsx   Recharts AreaChart: request count + error count over time
│       │       ├── LatencyChart.tsx  Recharts LineChart: P50/P90/P99 percentiles
│       │       └── ErrorRateChart.tsx Recharts AreaChart: error rate % derived from volume data
│       ├── hooks/
│       │   ├── useLiveLogs.ts        Polls /api/projects/:id/logs every 3 s; highlights new rows
│       │   ├── useAnalytics.ts       useVolumeData / useLatencyData / useTopRoutes / useErrorList (60 s poll)
│       │   ├── useAlerts.ts          useAlerts + useAlertHistory (single-fetch with refetch)
│       │   └── useUptime.ts          Polls /api/projects/:id/uptime every 60 s
│       └── lib/
│           ├── api.ts                apiFetch<T>() — fetch wrapper with Clerk token injection
│           ├── api-proxy.ts          proxyToApi() — Next.js → Fastify API forwarder
│           └── utils.ts              relativeTime / formatResponseTime / statusCategory helpers
│
└── packages/
    ├── db/                           Prisma ORM + PrismaClient singleton
    │   ├── src/index.ts              Exports singleton PrismaClient
    │   └── prisma/
    │       ├── schema.prisma         All models (User, Project, RequestLog, ErrorEvent, UptimeCheck, Alert, AlertEvent)
    │       ├── timescale-setup.sql   Creates hypertable + two continuous aggregates + index
    │       └── migrations/
    │           ├── 20260517055102_init/migration.sql               Base tables
    │           ├── 20260517055845_fix_requestlog_composite_pk/     Composite PK for hypertable
    │           └── 20260518000000_phase4_alerting/migration.sql    AlertEvent table + Alert.url/route columns
    ├── types/                        Shared TypeScript interfaces (no runtime code)
    │   └── src/index.ts              All exported types: IngestEvent, RequestLogRow, ProjectStats, AlertRule, etc.
    └── sdk/                          @pulse/node npm package (Express/Fastify middleware)
        └── src/
            ├── index.ts              Exports: pulse, pulsePlugin, captureError
            ├── types.ts              PulseConfig, IngestEvent interfaces
            ├── core/
            │   ├── client.ts         PulseClient — sends batches to POST /ingest
            │   ├── buffer.ts         BatchBuffer — 500 ms interval or 10-event flush
            │   ├── sanitizer.ts      Header/field redaction rules
            │   └── errors.ts         captureError() — manual error reporting
            └── middleware/
                ├── express.ts        pulse() RequestHandler — patches res.end
                └── fastify.ts        pulsePlugin fp() — onRequest + onResponse hooks
```

---

## 2. Data Flow — The Big Picture

```mermaid
flowchart TD
    SDK["@pulse/node SDK\npackages/sdk/src/middleware/express.ts\nor fastify.ts"]
    BUFFER["BatchBuffer\npackages/sdk/src/core/buffer.ts\n500ms or 10 events"]
    CLIENT["PulseClient\npackages/sdk/src/core/client.ts\nPOST /ingest"]

    INGEST_ROUTE["POST /ingest\napps/api/src/routes/ingest.ts\nAPI-key auth + plan check"]
    REDIS_Q["BullMQ Queue: 'ingest'\napps/api/src/lib/queue.ts\nRedis backed"]

    WORKER["IngestProcessor\napps/worker/src/processors/ingest.processor.ts\nconcurrency: 10"]

    RL["RequestLog hypertable\nTimescaleDB"]
    EE["ErrorEvent table\nPostgreSQL"]

    EVAL["evaluateAlerts()\napps/worker/src/lib/alert-evaluator.ts"]
    DEBOUNCE["Redis debounce key\nalert:debounce:{alertId}\n5 min TTL"]
    NOTIFY["dispatch()\napps/worker/src/lib/notifications.ts\nEmail (Resend) or Slack"]
    AE["AlertEvent table\nPostgreSQL"]

    UPTIME_PROC["UptimeProcessor\napps/worker/src/processors/uptime.processor.ts\nevery 60 s"]
    UC["UptimeCheck table\nPostgreSQL"]

    WEB_API["Next.js API Route\napps/web/app/api/projects/[id]/analytics/volume/route.ts\n(and siblings)"]
    PROXY["proxyToApi()\napps/web/lib/api-proxy.ts"]
    API_ANALYTICS["GET /projects/:id/analytics/volume\napps/api/src/routes/analytics.ts\nClerk JWT auth"]
    AGG["request_stats_hourly / request_stats_daily\nTimescaleDB continuous aggregates"]

    HOOK["useVolumeData()\napps/web/hooks/useAnalytics.ts\n60 s poll"]
    CHART["VolumeChart\napps/web/components/charts/VolumeChart.tsx\nRecharts AreaChart"]

    SDK -->|"intercepts req/res"| BUFFER
    BUFFER -->|"flush batch"| CLIENT
    CLIENT -->|"POST /ingest\nAuthorization: Bearer pk_live_..."| INGEST_ROUTE
    INGEST_ROUTE -->|"add job per event"| REDIS_Q
    REDIS_Q -->|"dequeue"| WORKER
    WORKER -->|"prisma.requestLog.create"| RL
    WORKER -->|"prisma.errorEvent.upsert\nif statusCode >= 400"| EE
    WORKER -->|"fire-and-forget"| EVAL
    EVAL -->|"check debounce"| DEBOUNCE
    DEBOUNCE -->|"not debounced"| NOTIFY
    NOTIFY -->|"prisma.alertEvent.create"| AE
    NOTIFY -->|"Resend or Slack webhook"| AE

    UPTIME_PROC -->|"prisma.uptimeCheck.create"| UC
    UPTIME_PROC --> EVAL

    RL -->|"continuous agg refresh\nevery 30 min / 1 hour"| AGG
    AGG -->|"SELECT ... FROM request_stats_hourly"| API_ANALYTICS
    API_ANALYTICS --> WEB_API
    WEB_API --> PROXY
    PROXY --> HOOK
    HOOK -->|"data prop"| CHART
```

---

## 3. Backend API (`apps/api`)

All routes registered in `apps/api/src/index.ts`. Base URL: `http://localhost:3001`.

| Method | Path | File | Auth | Request | Response | DB / Redis touched |
|--------|------|------|------|---------|----------|--------------------|
| GET | `/health` | `routes/health.ts` | None | — | `{ status: 'ok', ts: ISO }` | None |
| POST | `/ingest` | `routes/ingest.ts` | Bearer API key | `{ events: IngestEvent[] }` (1–100) | `{ success: true, queued: number }` | Lookup `Project` by `apiKeyHash`; enqueue to `ingest` BullMQ queue |
| POST | `/projects` | `routes/projects.ts` | Clerk JWT | `{ name: string }` | `{ success, data: { projectId, name, apiKey (raw), apiKeyPrefix } }` | Read `User` by `clerkId`; create `Project` |
| POST | `/projects/:projectId/reveal-key` | `routes/projects.ts` | Clerk JWT | — | `{ success, data: { projectId, apiKey (raw), apiKeyPrefix } }` | Update `Project.apiKeyHash` + `.apiKeyPrefix` |
| GET | `/projects/:projectId/stats` | `routes/projects.ts` | Clerk JWT | `?range=1h\|6h\|24h\|7d` | `{ success, data: ProjectStats }` | Aggregate `RequestLog` + `ErrorEvent` |
| GET | `/projects/:projectId/logs` | `routes/projects.ts` | Clerk JWT | `?page=0&limit=20&status=all\|2xx\|4xx\|5xx` | `{ success, data: { logs: RequestLogRow[], total, page, hasMore } }` | Paginate `RequestLog` |
| GET | `/projects/:projectId/analytics/volume` | `routes/analytics.ts` | Clerk JWT | `?range=1h\|6h\|24h\|7d` | `{ success, data: VolumeBucket[] }` | `request_stats_hourly` or `request_stats_daily` aggregate |
| GET | `/projects/:projectId/analytics/latency` | `routes/analytics.ts` | Clerk JWT | `?range=...&route=optional` | `{ success, data: LatencyBucket[] }` | Raw `RequestLog` hypertable via `percentile_cont` |
| GET | `/projects/:projectId/analytics/top-routes` | `routes/analytics.ts` | Clerk JWT | `?range=...` | `{ success, data: TopRoute[] }` (top 10) | Raw `RequestLog` GROUP BY route, method |
| GET | `/projects/:projectId/analytics/errors` | `routes/analytics.ts` | Clerk JWT | `?range=...&page=0` | `{ success, data: ErrorGroup[], total, page, hasMore }` | `ErrorEvent` WHERE `lastSeen >= cutoff` |
| GET | `/projects/:projectId/alerts` | `routes/alerts.ts` | Clerk JWT | — | `{ success, data: AlertRule[] }` | `Alert` + latest `AlertEvent` (lastFired) |
| POST | `/projects/:projectId/alerts` | `routes/alerts.ts` | Clerk JWT | `{ type, channel, destination, threshold, url?, route?, active? }` | `{ success, data: Alert }` | Create `Alert` |
| PATCH | `/projects/:projectId/alerts/:alertId` | `routes/alerts.ts` | Clerk JWT | `{ active?, threshold?, destination? }` | `{ success, data: Alert }` | Update `Alert` |
| DELETE | `/projects/:projectId/alerts/:alertId` | `routes/alerts.ts` | Clerk JWT | — | `{ success: true }` | Delete `Alert` (cascades to `AlertEvent`) |
| GET | `/projects/:projectId/alerts/history` | `routes/alerts.ts` | Clerk JWT | `?page=1&limit=20` | `{ success, data: AlertHistoryEntry[], total, page, hasMore }` | `AlertEvent` ORDER BY `sentAt DESC` |
| GET | `/projects/:projectId/uptime` | `routes/alerts.ts` | Clerk JWT | — | `{ success, data: UptimeStatus }` | Last 100 `UptimeCheck` records |
| POST | `/webhooks/clerk` | `routes/webhooks/clerk.ts` | Svix signature | Clerk webhook body | `{ success: true }` | Upsert `User` (clerkId, email) on `user.created` event |

**Auth implementation:**
- **Clerk JWT**: `verifyToken(token, { secretKey })` from `@clerk/backend` — extracts `sub` (Clerk user ID) → looks up `User.clerkId` in DB to get internal user.
- **API Key**: SHA-256 hash of Bearer token → `prisma.project.findUnique({ where: { apiKeyHash } })`.
- **Svix**: Raw body captured in `preParsing` hook; `new Webhook(CLERK_WEBHOOK_SECRET).verify(rawBody, headers)`.

---

## 4. Database Schema

### User

| Field | Type | Constraints |
|-------|------|-------------|
| id | String | PK, `@default(cuid())` |
| email | String | `@unique` |
| clerkId | String | `@unique` |
| plan | Plan enum | `@default(FREE)` |
| createdAt | DateTime | `@default(now())` |
| projects | Project[] | one-to-many |

### Project

| Field | Type | Constraints |
|-------|------|-------------|
| id | String | PK, `@default(cuid())` |
| name | String | — |
| apiKeyHash | String | `@unique` (SHA-256 hex) |
| apiKeyPrefix | String | first 8 chars of raw key |
| userId | String | FK → User.id |
| createdAt | DateTime | `@default(now())` |
| logs | RequestLog[] | one-to-many |
| errors | ErrorEvent[] | one-to-many |
| checks | UptimeCheck[] | one-to-many |
| alerts | Alert[] | one-to-many |
| alertEvents | AlertEvent[] | one-to-many |

### RequestLog *(TimescaleDB hypertable)*

| Field | Type | Constraints |
|-------|------|-------------|
| id | String | part of composite PK, `@default(cuid())` |
| projectId | String | FK → Project.id |
| method | String | e.g. `"GET"` |
| route | String | matched pattern e.g. `"/users/:id"` |
| statusCode | Int | 100–599 |
| responseTime | Int | milliseconds |
| timestamp | DateTime | part of composite PK; **hypertable partition column** |

**Composite PK:** `@@id([id, timestamp])` — required by TimescaleDB hypertable.
**Index:** `RequestLog_projectId_timestamp_idx` on `(projectId, timestamp DESC)`.

### ErrorEvent

| Field | Type | Constraints |
|-------|------|-------------|
| id | String | PK, `@default(cuid())` |
| projectId | String | FK → Project.id |
| message | String | e.g. `"HTTP 500"` |
| stack | String? | optional stack trace |
| route | String | |
| statusCode | Int | |
| count | Int | `@default(1)`, incremented on upsert |
| firstSeen | DateTime | |
| lastSeen | DateTime | updated on each upsert |

**Unique constraint:** `@@unique([projectId, route, statusCode])` — groups errors by route+status.

### UptimeCheck

| Field | Type | Constraints |
|-------|------|-------------|
| id | String | PK, `@default(cuid())` |
| projectId | String | FK → Project.id |
| url | String | the URL being monitored |
| status | String | `'up'` or `'down'` |
| responseTime | Int? | ms; null on timeout |
| checkedAt | DateTime | |

### Alert

| Field | Type | Constraints |
|-------|------|-------------|
| id | String | PK, `@default(cuid())` |
| projectId | String | FK → Project.id |
| type | String | `'uptime'` \| `'error_rate'` \| `'response_time'` |
| threshold | Float | % for error_rate; ms for response_time; unused for uptime |
| channel | String | `'email'` \| `'slack'` |
| destination | String | email address or Slack webhook URL |
| active | Boolean | `@default(true)` |
| url | String? | required for uptime alerts |
| route | String? | optional filter for response_time alerts |
| events | AlertEvent[] | one-to-many (cascade delete) |

### AlertEvent

| Field | Type | Constraints |
|-------|------|-------------|
| id | String | PK, `@default(cuid())` |
| alertId | String | FK → Alert.id, `onDelete: Cascade` |
| projectId | String | FK → Project.id, `onDelete: Cascade` |
| type | String | mirrors Alert.type |
| triggeredValue | Float | actual measured value |
| threshold | Float | alert threshold at time of firing |
| message | String | human-readable explanation |
| channel | String | `'email'` \| `'slack'` |
| destination | String | |
| sentAt | DateTime | `@default(now())` |

### Plan Enum

`FREE` | `STARTER` | `PRO` | `ENTERPRISE`

### Mermaid ER Diagram

```mermaid
erDiagram
    User {
        String id PK
        String email UK
        String clerkId UK
        Plan plan
        DateTime createdAt
    }
    Project {
        String id PK
        String name
        String apiKeyHash UK
        String apiKeyPrefix
        String userId FK
        DateTime createdAt
    }
    RequestLog {
        String id
        DateTime timestamp
        String projectId FK
        String method
        String route
        Int statusCode
        Int responseTime
    }
    ErrorEvent {
        String id PK
        String projectId FK
        String message
        String stack
        String route
        Int statusCode
        Int count
        DateTime firstSeen
        DateTime lastSeen
    }
    UptimeCheck {
        String id PK
        String projectId FK
        String url
        String status
        Int responseTime
        DateTime checkedAt
    }
    Alert {
        String id PK
        String projectId FK
        String type
        Float threshold
        String channel
        String destination
        Boolean active
        String url
        String route
    }
    AlertEvent {
        String id PK
        String alertId FK
        String projectId FK
        String type
        Float triggeredValue
        Float threshold
        String message
        String channel
        String destination
        DateTime sentAt
    }

    User ||--o{ Project : "owns"
    Project ||--o{ RequestLog : "has"
    Project ||--o{ ErrorEvent : "has"
    Project ||--o{ UptimeCheck : "has"
    Project ||--o{ Alert : "has"
    Project ||--o{ AlertEvent : "has"
    Alert ||--o{ AlertEvent : "fires (cascade delete)"
```

---

## 5. TimescaleDB Layer

### Hypertable

| Table | Partition Column | Created By |
|-------|-----------------|------------|
| `RequestLog` | `timestamp` | `packages/db/prisma/timescale-setup.sql` via `create_hypertable('\"RequestLog\"', 'timestamp', if_not_exists => TRUE)` |

### Continuous Aggregate Views

| View Name | Source Table | Bucket Size | Columns Computed | Refresh Policy |
|-----------|-------------|-------------|-----------------|----------------|
| `request_stats_hourly` | `RequestLog` | `1 hour` | `projectId, route, method, bucket, request_count, error_count, avg_response_time, sum_response_time, min_response_time, max_response_time` | Every 30 min; covers last 3 hours |
| `request_stats_daily` | `RequestLog` | `1 day` | same columns | Every 1 hour; covers last 3 days |

**Why two views?**
- `request_stats_hourly` serves 1h and 6h range queries (fine-grained time buckets).
- `request_stats_daily` serves 24h and 7d range queries (coarser time buckets).

**Percentile queries (`P50/P90/P99`) are not materialized** — they use `percentile_cont` on the raw hypertable because TimescaleDB standard continuous aggregates cannot store ordered-set aggregates. The composite index `(projectId, timestamp DESC)` makes these fast.

### Which Routes Query What

| API Route | Source |
|-----------|--------|
| `GET /analytics/volume` | `request_stats_hourly` or `request_stats_daily` (chosen by range) |
| `GET /analytics/latency` | Raw `RequestLog` hypertable — `percentile_cont(0.5/0.9/0.99)` |
| `GET /analytics/top-routes` | Raw `RequestLog` hypertable — GROUP BY route, method |
| `GET /analytics/errors` | `ErrorEvent` table |
| `GET /projects/:id/stats` | Raw `RequestLog` + `ErrorEvent` aggregate counts |
| `GET /uptime` | `UptimeCheck` table (last 100 rows) |

---

## 6. Redis & BullMQ

### Queues

| Queue Name | Defined In | Purpose |
|------------|-----------|---------|
| `'ingest'` | `apps/api/src/lib/queue.ts` | Buffers ingest events from SDK before DB write |
| `'uptime'` | `apps/worker/src/index.ts` | Carries repeatable uptime-check jobs |

### Job Types

| Queue | Job Name | Enqueued By | Payload | Processed By |
|-------|----------|-------------|---------|-------------|
| `ingest` | `'process'` | `apps/api/src/routes/ingest.ts` | `{ projectId, method, route, statusCode, responseTime, timestamp }` | `apps/worker/src/processors/ingest.processor.ts` |
| `uptime` | `'uptime-check'` | `apps/worker/src/index.ts` (repeatable, every 60 s) | `{}` (empty) | `apps/worker/src/processors/uptime.processor.ts` |

### Worker Processors

**`ingest.processor.ts`** (concurrency: 10)

1. Validate job data; throw if missing required fields.
2. `prisma.requestLog.create({ data: { projectId, method, route, statusCode, responseTime, timestamp } })`.
3. If `statusCode >= 400`: `prisma.errorEvent.upsert` — increment `count`, update `lastSeen`, or create new row.
4. `evaluateAlerts(projectId)` — fire-and-forget (errors logged, never rethrown into job).

**`uptime.processor.ts`** (concurrency: 1, repeatable every 60 000 ms)

1. `prisma.alert.findMany({ where: { type: 'uptime', active: true, url: { not: null } } })`.
2. `Promise.all(alerts.map(a => pingAndRecord(a.projectId, a.url)))`.
3. Per URL: HTTP GET with 10 s AbortController timeout; record `status ('up'|'down')`, `responseTime`.
4. `prisma.uptimeCheck.create({ data: { projectId, url, status, responseTime, checkedAt } })`.
5. `evaluateAlerts(projectId)` for uptime alert evaluation.

### BullMQ Job Options

```
removeOnComplete: 1000   (keep last 1000 completed jobs)
removeOnFail:    5000    (remove failed jobs after 5 s)
```

### Rate Limiting Keys (Redis)

| Key Pattern | Limit | Window | Defined In |
|-------------|-------|--------|-----------|
| `rl:key:{first 16 chars of Bearer token}` | 100 requests | 10 seconds | `apps/api/src/plugins/rate-limit.ts` |
| `rl:ip:{request.ip}` | 100 requests | 10 seconds | `apps/api/src/plugins/rate-limit.ts` |

### Alert Debounce Keys (Redis)

| Key Pattern | TTL | Set By |
|-------------|-----|--------|
| `alert:debounce:{alertId}` | 300 s (5 min) | `apps/worker/src/lib/alert-evaluator.ts` — `fireAlert()` |

---

## 7. Frontend — Pages & Routes

| URL Path | File | Component Type | Data Fetched | Auth Required |
|----------|------|---------------|-------------|---------------|
| `/` | `apps/web/app/page.tsx` | Server Component | Clerk `auth()` session | No (redirects to `/dashboard` if signed in) |
| `/sign-in` | `apps/web/app/(auth)/sign-in/[[...sign-in]]/page.tsx` | Client (Clerk) | Clerk managed | No |
| `/sign-up` | `apps/web/app/(auth)/sign-up/[[...sign-up]]/page.tsx` | Client (Clerk) | Clerk managed | No |
| `/dashboard` | `apps/web/app/dashboard/page.tsx` | Client Component | `GET /api/projects` | Yes (Clerk middleware) |
| `/dashboard/logs` | `apps/web/app/dashboard/logs/page.tsx` | Client Component | `useLiveLogs` → `GET /api/projects/[id]/logs` every 3 s | Yes |
| `/dashboard/analytics` | `apps/web/app/dashboard/analytics/page.tsx` | Client Component | `useVolumeData`, `useLatencyData`, `useTopRoutes` every 60 s | Yes |
| `/dashboard/errors` | `apps/web/app/dashboard/errors/page.tsx` | Client Component | `useErrorList` → `GET /api/projects/[id]/analytics/errors` | Yes |
| `/dashboard/alerts` | `apps/web/app/dashboard/alerts/page.tsx` | Client Component | `useAlerts`, `useAlertHistory` | Yes |
| `/dashboard/uptime` | `apps/web/app/dashboard/uptime/page.tsx` | Client Component | `useUptime` → `GET /api/projects/[id]/uptime` every 60 s | Yes |

**Dashboard Layout** (`apps/web/app/dashboard/layout.tsx`) is a **Server Component** that:
- Calls Clerk `auth()` and redirects if unauthenticated.
- Fetches `User` + `projects` directly from PostgreSQL via Prisma.
- Has a fallback `upsert` for local dev (Clerk webhook may not fire in dev).
- Renders `<Sidebar projects={...} />` as a shared shell.

---

## 8. Frontend — Components

| Component | File | Props | Dependencies | What it renders |
|-----------|------|-------|-------------|-----------------|
| `Sidebar` | `components/Sidebar.tsx` | `projects: ProjectSummary[]` | `usePathname`, `useRouter`, `useSearchParams`, Clerk `UserButton` | Dark sidebar with logo, project `<select>`, nav buttons, Clerk avatar |
| `StatsCards` | `components/StatsCards.tsx` | `projectId: string` | `GET /api/projects/[id]/stats` (internal fetch) | 4 metric cards: Total Requests, Last 24h, Error Rate %, Avg Response Time |
| `LogTable` | `components/LogTable.tsx` | `projectId: string` | `GET /api/projects/[id]/logs` (paginated fetch) | Paginated table with status filter tabs (All / 2xx / 4xx / 5xx); method + status badges |
| `CreateProjectModal` | `components/CreateProjectModal.tsx` | `onClose: () => void` | `POST /api/projects` (via `apiFetch`) | Step 1: project name form. Step 2: one-time API key display with copy button |
| `RegenerateKeyModal` | `components/RegenerateKeyModal.tsx` | `projectId: string`, `onClose: () => void` | `POST /api/projects/[id]/reveal-key` | Confirmation warning → new API key reveal with copy button |
| `TimeRangeSelector` | `components/TimeRangeSelector.tsx` | `value: TimeRange`, `onChange: (r) => void` | None | Tab buttons: 1h / 6h / 24h / 7d |
| `TopRoutesTable` | `components/TopRoutesTable.tsx` | `data: TopRoute[]`, `isLoading: boolean` | None | Table rows: route, method badge, request count, error rate bar, avg/P99 latency |
| `VolumeChart` | `components/charts/VolumeChart.tsx` | `data: VolumeBucket[]`, `range: TimeRange`, `isLoading: boolean` | Recharts `AreaChart` | Stacked area chart: request volume (indigo) + error count (red) over time |
| `LatencyChart` | `components/charts/LatencyChart.tsx` | `data: LatencyBucket[]`, `range: TimeRange`, `isLoading: boolean` | Recharts `LineChart` | Three lines: P50 (green), P90 (yellow), P99 (red) |
| `ErrorRateChart` | `components/charts/ErrorRateChart.tsx` | `data: VolumeBucket[]`, `range: TimeRange`, `isLoading: boolean` | Recharts `AreaChart` | Single area: error rate % derived from `errorCount / count * 100` |

---

## 9. Frontend — Hooks

### `useLiveLogs`
**File:** `apps/web/hooks/useLiveLogs.ts`

| Item | Detail |
|------|--------|
| Parameters | `projectId: string`, `statusCategory: 'all' \| '2xx' \| '4xx' \| '5xx'` |
| Fetches | `GET /api/projects/{projectId}/logs?limit=50&since={lastTimestamp}&status={statusCategory}` |
| Poll interval | 3 seconds |
| Max buffer | 500 log entries (drops oldest) |
| New-row highlight | Tracks `newRowIds` Set; clears each row's highlight after 1 200 ms |
| Returns | `{ logs: RequestLogRow[], isPolling: boolean, newRowIds: Set<string> }` |
| Visibility | Continues polling when tab is hidden |

### `useAnalytics` (exports four hooks)
**File:** `apps/web/hooks/useAnalytics.ts`

All four use a shared `usePollData<T>` implementation.

| Hook | Fetches | Poll interval | Returns |
|------|---------|--------------|---------|
| `useVolumeData(projectId, range)` | `GET /api/projects/{id}/analytics/volume?range={range}` | 60 s | `{ data: VolumeBucket[], isLoading, error }` |
| `useLatencyData(projectId, range)` | `GET /api/projects/{id}/analytics/latency?range={range}` | 60 s | `{ data: LatencyBucket[], isLoading, error }` |
| `useTopRoutes(projectId, range)` | `GET /api/projects/{id}/analytics/top-routes?range={range}` | 60 s | `{ data: TopRoute[], isLoading, error }` |
| `useErrorList(projectId, range)` | `GET /api/projects/{id}/analytics/errors?range={range}` | 60 s | `{ data: ErrorGroup[], isLoading, error }` |

All four pause polling when `document.visibilityState === 'hidden'` and resume on `visibilitychange`.

### `useAlerts`
**File:** `apps/web/hooks/useAlerts.ts`

| Item | Detail |
|------|--------|
| Exports | `useAlerts(projectId)`, `useAlertHistory(projectId, page)` |
| `useAlerts` fetches | `GET /api/projects/{id}/alerts` |
| `useAlertHistory` fetches | `GET /api/projects/{id}/alerts/history?page={page}&limit=20` |
| Polling | None — single fetch with `refetch()` callback |
| Returns (`useAlerts`) | `{ data: AlertRule[], isLoading, error, refetch }` |
| Returns (`useAlertHistory`) | `{ data: AlertHistoryEntry[], total, isLoading, error }` |

### `useUptime`
**File:** `apps/web/hooks/useUptime.ts`

| Item | Detail |
|------|--------|
| Parameters | `projectId: string` |
| Fetches | `GET /api/projects/{projectId}/uptime` |
| Poll interval | 60 seconds |
| Visibility pause | Yes — pauses when tab hidden |
| Returns | `{ data: UptimeStatus \| null, isLoading, error }` |

---

## 10. Authentication Flow

### Sign-up / Sign-in (Clerk managed)

1. User visits `/sign-up` or `/sign-in` — Clerk `SignUp`/`SignIn` components render (catch-all routes at `app/(auth)/sign-*/[[...sign-*]]/page.tsx`).
2. Clerk handles OAuth / email+password; issues a session JWT to the browser.
3. After success, Clerk redirects to `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard`.

### User Sync to PostgreSQL (Clerk Webhook)

1. Clerk fires `user.created` event to `POST /webhooks/clerk`.
2. `apps/api/src/routes/webhooks/clerk.ts`:
   - Reads raw body captured by `preParsing` hook (needed for Svix HMAC verification).
   - `new Webhook(CLERK_WEBHOOK_SECRET).verify(rawBody, { 'svix-id', 'svix-timestamp', 'svix-signature' })`.
   - Extracts primary email from `event.data.email_addresses`.
   - `prisma.user.upsert({ where: { clerkId }, update: {}, create: { clerkId, email } })`.

**Fallback (local dev):** `apps/web/app/dashboard/layout.tsx` detects missing user and upserts directly from `currentUser()` (Clerk server SDK). This handles the case where the local webhook didn't fire.

### Frontend JWT Acquisition

- `apps/web/lib/api.ts` — `apiFetch<T>(path)`:
  - Calls Clerk's `useAuth().getToken()` to get a short-lived JWT.
  - Attaches it as `Authorization: Bearer {token}` on every fetch to `/api/*` Next.js routes.

### Fastify JWT Verification

- `apps/api/src/lib/auth.ts` — `verifyClerkJwt(authHeader, reply)`:
  - Strips `Bearer ` prefix.
  - Calls `verifyToken(token, { secretKey: CLERK_SECRET_KEY })` from `@clerk/backend`.
  - Returns `payload.sub` (Clerk user ID string) on success; sends `401` and returns `null` on failure.
  - Callers then do `prisma.user.findUnique({ where: { clerkId: sub } })` to get the internal user.

### API Key Auth (Ingestion Route)

1. SDK sends `Authorization: Bearer pk_live_{64 hex chars}` with each ingest batch.
2. `apps/api/src/routes/ingest.ts`:
   - Extracts raw key from header.
   - `hashApiKey(rawKey)` → SHA-256 hex.
   - `prisma.project.findUnique({ where: { apiKeyHash: hash } })`.
   - If not found: `401`.
   - Checks `isOverPlanLimit(projectId, user.plan)` → `402` if over limit.
3. `apps/api/src/lib/api-key.ts`:
   - `generateApiKey()`: `'pk_live_' + crypto.randomBytes(32).toString('hex')` (71-char string).
   - `hashApiKey(key)`: `crypto.createHash('sha256').update(key).digest('hex')`.
   - `getApiKeyPrefix(key)`: `key.slice(0, 8)`.

---

## 11. Environment Variables

| Variable | Used By | What it does | Required | Example |
|----------|---------|-------------|----------|---------|
| `NODE_ENV` | api, worker, web | Development/production mode switches | No | `development` |
| `PORT` | api | Fastify listen port | No | `3001` |
| `DATABASE_URL` | api, worker, web (via Prisma) | PostgreSQL + TimescaleDB connection string | Yes | `postgresql://pulse:pulse@localhost:5432/pulse` |
| `REDIS_URL` | api, worker | IORedis connection URL | Yes | `redis://localhost:6379` |
| `CLERK_SECRET_KEY` | api, web | Clerk backend API key for JWT verification | Yes | `sk_test_abc...` |
| `CLERK_WEBHOOK_SECRET` | api | Svix signing secret for verifying Clerk webhook payloads | Yes | `whsec_abc...` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | web (browser) | Clerk frontend key | Yes | `pk_test_abc...` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | web | Clerk sign-in redirect path | No | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | web | Clerk sign-up redirect path | No | `/sign-up` |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` | web | Post-login redirect | No | `/dashboard` |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | web | Post-registration redirect | No | `/dashboard` |
| `RESEND_API_KEY` | worker | Resend email service API key | No (email alerts silently skipped without it) | `re_abc...` |
| `RESEND_FROM_EMAIL` | worker | Sender address for alert emails | Yes if `RESEND_API_KEY` set | `alerts@yourdomain.com` |
| `INGESTION_API_URL` | web | Base URL of the Fastify API (used by `proxyToApi`) | No | `http://localhost:3001` |
| `API_KEY_SECRET` | api | Min-32-char secret for rate-limit key fingerprinting | Yes | `change_me_in_production_32_chars_min` |
| `STRIPE_SECRET_KEY` | — | Stripe billing (Phase 6, no code yet) | No | `sk_test_abc...` |
| `STRIPE_WEBHOOK_SECRET` | — | Stripe webhook (Phase 6, no code yet) | No | `whsec_abc...` |
| `NEXT_PUBLIC_APP_URL` | worker | Dashboard URL injected into alert email CTAs | No | `http://localhost:3000` |
| `PULSE_HOST` | sdk consumers | SDK ingest endpoint (overrides default) | No | `https://api.pulse.dev` |

---

## 12. Docker & Infrastructure

### Services (`docker-compose.yml`)

| Service | Image | Container Name | Ports | Volumes | Health Check |
|---------|-------|---------------|-------|---------|-------------|
| `timescaledb` | `timescale/timescaledb:latest-pg15` | `pulse-timescaledb` | `5432:5432` | `pgdata:/var/lib/postgresql/data` | `pg_isready -U pulse -d pulse` (10 s interval, 5 retries) |
| `redis` | `redis:7-alpine` | `pulse-redis` | `6379:6379` | `redisdata:/data` | `redis-cli ping` (10 s interval, 5 retries) |

**Env vars for timescaledb container:**
- `POSTGRES_USER=pulse`
- `POSTGRES_PASSWORD=pulse`
- `POSTGRES_DB=pulse`

**Named volumes:** `pgdata`, `redisdata` (persisted across container restarts).

### TimescaleDB Extension Setup

The `timescaledb` image ships with the extension pre-installed. It is enabled automatically when the container initializes. No explicit `CREATE EXTENSION` SQL is needed in migrations.

**Hypertable + aggregate creation** is done via `packages/db/prisma/timescale-setup.sql`, which must be run **after** `prisma migrate deploy`. It uses `IF NOT EXISTS` guards so it is safe to re-run:

```
SELECT create_hypertable('"RequestLog"', 'timestamp', if_not_exists => TRUE);
CREATE MATERIALIZED VIEW IF NOT EXISTS request_stats_hourly WITH (timescaledb.continuous) AS ...;
CREATE MATERIALIZED VIEW IF NOT EXISTS request_stats_daily  WITH (timescaledb.continuous) AS ...;
SELECT add_continuous_aggregate_policy('request_stats_hourly', ...);
SELECT add_continuous_aggregate_policy('request_stats_daily',  ...);
CREATE INDEX IF NOT EXISTS "RequestLog_projectId_timestamp_idx" ON "RequestLog" ("projectId", timestamp DESC);
```

### Service Connectivity

```
apps/api (port 3001)
  → timescaledb on localhost:5432 (DATABASE_URL)
  → redis on localhost:6379 (REDIS_URL)

apps/worker (no port)
  → timescaledb on localhost:5432 (DATABASE_URL)
  → redis on localhost:6379 (REDIS_URL)
  → external: Resend HTTPS API (email)
  → external: Slack webhook URLs (Slack)

apps/web (port 3000)
  → timescaledb on localhost:5432 (DATABASE_URL, direct Prisma in server components)
  → apps/api on localhost:3001 (INGESTION_API_URL, via proxyToApi)
  → external: Clerk HTTPS API (auth)
```

---

## 13. SDK (`packages/sdk`)

Package name: `@pulse/node`. Published to npm. Supports Express and Fastify 4.x.

### Middleware Lifecycle — Express (`middleware/express.ts`)

1. User calls `app.use(pulse({ apiKey: 'pk_live_...' }))`.
2. `PulseClient` is instantiated with `host`, `timeout`, `debug` config.
3. `setClient(client)` stores reference for `captureError()` to use.
4. `BatchBuffer` is created with `onFlush: (events) => client.send(events)`.
5. `buffer.start()` starts the 500 ms flush interval (timer is `unref()`'d).
6. `SIGTERM` / `SIGINT` handlers registered: call `buffer.stop()` → flushes remaining events.
7. Per-request: the middleware checks `ignoreMethods` and `ignoreRoutes` prefix matches.
8. `res.end` is monkey-patched: calls original then records `{ method, route, statusCode, responseTime, timestamp }` and calls `buffer.add(event)`.
9. `route` prefers `req.route?.path` (matched Express pattern) over `req.path` to avoid high-cardinality IDs.

### Middleware Lifecycle — Fastify (`middleware/fastify.ts`)

1. User calls `fastify.register(pulsePlugin, { apiKey: 'pk_live_...' })`.
2. Same `PulseClient` + `BatchBuffer` setup as Express.
3. `fastify.addHook('onRequest', ...)` stores `req.pulseStartTime = Date.now()`.
4. `fastify.addHook('onResponse', ...)` computes `responseTime`, applies filters, calls `buffer.add(event)`.
5. `route` prefers `req.routerPath` (Fastify matched pattern) over raw `req.url`.

### Data Captured per Event

| Field | Source |
|-------|--------|
| `method` | `req.method` |
| `route` | `req.route?.path` (Express) or `req.routerPath` (Fastify) — falls back to raw path |
| `statusCode` | `res.statusCode` (Express) or `reply.statusCode` (Fastify) |
| `responseTime` | `Date.now() - startTime` in ms |
| `timestamp` | `new Date().toISOString()` at response time |

### Batching & Sending

- Buffer holds events until: (a) 10 events accumulated, OR (b) 500 ms elapsed.
- `PulseClient.send(events)` POSTs to `{host}/ingest` with `Authorization: Bearer {apiKey}`.
- Uses `AbortController` with configurable timeout (default 5 000 ms).
- **On failure**: logs warning and silently drops events (never throws, never retries).
- **402 response**: logs "monthly limit reached" warning.
- **429 response**: logs "rate limited" warning.

### Header / Field Sanitization (`core/sanitizer.ts`)

**Headers never captured** (reserved for Phase 5):
`authorization, cookie, set-cookie, x-api-key, x-auth-token, x-access-token, proxy-authorization`

**Body fields redacted** (when `captureBody: true` is eventually enabled):
`password, secret, token, apikey, api_key, creditcard, ssn, cvv`

**Max body size:** 2 048 bytes; longer bodies appended with `[truncated]`.

### `captureError(error, context?)` (`core/errors.ts`)

- Manually reports an error from background jobs or catch blocks.
- Creates an `IngestEvent` with `statusCode: 500`, `responseTime: 0`, `route: context?.route ?? 'unknown'`.
- Sends immediately via `_client.send([event])` — bypasses the batch buffer.
- Warns (does not throw) if called before middleware initialised (`_client` is null).

---

## 14. Inter-Package Dependencies

```mermaid
graph TD
    API["apps/api"]
    WORKER["apps/worker"]
    WEB["apps/web"]
    DB["@pulse/db"]
    TYPES["@pulse/types"]
    SDK["@pulse/node (sdk)"]

    API -->|"imports PrismaClient\n(singleton)"| DB
    API -->|"imports IngestEvent\nRequestLogRow\nProjectStats\nApiResponse"| TYPES

    WORKER -->|"imports PrismaClient\n(singleton)"| DB
    WORKER -->|"imports IngestEvent\nAlertRule types"| TYPES

    WEB -->|"imports PrismaClient\n(server components\n& API routes)"| DB
    WEB -->|"imports ProjectSummary\nRequestLogRow\nVolumeBucket\nLatencyBucket\nTopRoute\nErrorGroup\nAlertRule\nUptimeStatus"| TYPES

    SDK -.->|"no internal deps\n(standalone npm pkg)"| TYPES

    note1["SDK users import @pulse/node\nand point it at apps/api"]
```

---

## 15. Known Gaps & TODOs

### Routes Defined but Not Fully Implemented

| Route | File | Issue |
|-------|------|-------|
| `POST /projects/:projectId/reveal-key` | `apps/api/src/routes/projects.ts` | Marked **DEV ONLY** in comments — regenerates the API key, breaking all existing SDK integrations. Must be removed before production. |

### Components Using Mock / Hardcoded Data

None found. All components fetch live data from API routes. However:

- `StatsCards.tsx` computes `errorRate` and `avgResponseTime` from the `/stats` endpoint, which aggregates raw `RequestLog` — the accuracy depends on the sampling window configured in that route (not fully documented in the route itself).

### Features Stubbed in Code with No Implementation Yet

| Feature | Where Stubbed | Status |
|---------|-------------|--------|
| `captureBody: boolean` in `PulseConfig` | `packages/sdk/src/types.ts` | Field exists in type; body capture logic not implemented in middleware |
| `captureHeaders: boolean` in `PulseConfig` | `packages/sdk/src/types.ts` | Field exists in type; header capture not implemented |
| Stripe billing (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) | `.env.example` | Env vars present but zero code references — Phase 6 not started |

### Phases with No Code Yet

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 5 — SDK Polish | Body capture, header capture, additional framework adapters (Hono, Koa, etc.) | No code; types stubbed only |
| Phase 6 — Billing | Stripe metered billing, usage dashboard, plan enforcement beyond request counts | No code; env vars stubbed |

### Architectural Notes / Subtle Constraints

- **`RequestLog` composite PK** `[id, timestamp]` is required by TimescaleDB's hypertable partitioning. Prisma does not natively model this — the second migration (`20260517055845_fix_requestlog_composite_pk`) adds it via raw SQL after the initial migration.
- **Percentile aggregates** (`P50/P90/P99`) are always computed from the raw hypertable, never from the continuous aggregates, because `percentile_cont` is an ordered-set aggregate that TimescaleDB standard continuous aggregates cannot store. This means latency queries get slower as the hypertable grows. A future optimization would be to use `timescaledb_toolkit` `percentile_agg` functions.
- **`reveal-key` route** exists in `apps/web/app/api/projects/[id]/reveal-key/route.ts` (Next.js) and `apps/api/src/routes/projects.ts` (Fastify). Both must be removed before public launch.
- **Dashboard layout upsert fallback** in `apps/web/app/dashboard/layout.tsx` will silently create a `User` row without the `plan` field being set by Clerk (defaults to `FREE`). This is intentional for local dev ergonomics but means the webhook is load-bearing in production for correct plan assignment.