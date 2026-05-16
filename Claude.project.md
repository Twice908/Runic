# CLAUDE.md — Pulse Project Context

> This file contains everything Claude needs to understand the Pulse product,
> its architecture, goals, and phase-by-phase build plan.
> Always read this before writing any Pulse-related code.

---

## What is Pulse?

Pulse is a **lightweight backend observability SaaS** for solo developers and small teams (2-10 people) who are priced out of Datadog and New Relic.

**Core value prop**: Drop one line into any Express/Fastify app → get real-time request logs, error tracking, slow endpoint detection, and uptime alerts. Pay $20-80/month.

**Target user**: A developer shipping a backend on Railway, Render, or Fly.io who has zero observability and finds out about prod issues from angry users.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Ingestion API | Node.js + **Fastify** |
| Queue | **Redis** + **BullMQ** |
| Metrics DB | **TimescaleDB** (PostgreSQL extension) |
| App DB | **PostgreSQL** + **Prisma** ORM |
| Dashboard | **Next.js 14** (App Router) + **Tailwind CSS** |
| Auth | **Clerk** |
| Billing | **Stripe** (metered usage-based billing) |
| Email Alerts | **Resend** |
| Slack Alerts | Slack Webhooks |
| SDK | **`@pulse/node`** npm package |
| Deployment | **Railway** (dev/staging), AWS (prod later) |

---

## System Architecture

```
Developer's Backend (Express / Fastify / any Node HTTP)
         |
         | SDK fires async HTTP — never blocks user request
         ↓
  ┌──────────────────┐
  │  Ingestion API   │  ← Fastify, <50ms p99, API key auth
  └────────┬─────────┘
           ↓
  ┌──────────────────┐
  │   Redis Queue    │  ← BullMQ, decouples ingestion from DB writes
  └────────┬─────────┘
           ↓
  ┌──────────────────┐
  │  Worker Service  │  ← processes logs, groups errors, computes metrics
  └────────┬─────────┘
           ↓
    ┌──────┴──────────┐
    ↓                 ↓
TimescaleDB       PostgreSQL
(RequestLog,      (User, Project,
 UptimeCheck)      Alert, ErrorEvent)
    │                 │
    └──────┬──────────┘
           ↓
  ┌──────────────────┐
  │  Dashboard API   │  ← Next.js API routes
  └────────┬─────────┘
           ↓
  ┌──────────────────┐
  │  Dashboard UI    │  ← Recharts, real-time polling
  └──────────────────┘
```

---

## Monorepo Structure

```
pulse/
├── apps/
│   ├── api/              ← Fastify ingestion + REST API
│   ├── worker/           ← BullMQ worker service
│   └── web/              ← Next.js 14 dashboard
├── packages/
│   ├── sdk/              ← @pulse/node npm package
│   ├── db/               ← Prisma schema + client (shared)
│   └── types/            ← shared TypeScript types
├── CLAUDE.system.md
├── CLAUDE.project.md
└── package.json          ← workspace root (npm workspaces or turborepo)
```

---

## Prisma Data Models

```prisma
model User {
  id        String    @id @default(cuid())
  email     String    @unique
  clerkId   String    @unique
  plan      Plan      @default(FREE)
  projects  Project[]
  createdAt DateTime  @default(now())
}

model Project {
  id           String        @id @default(cuid())
  name         String
  apiKeyHash   String        @unique   // SHA-256 hash — never store plain
  apiKeyPrefix String                  // first 8 chars shown in UI
  userId       String
  user         User          @relation(fields: [userId], references: [id])
  logs         RequestLog[]
  errors       ErrorEvent[]
  checks       UptimeCheck[]
  alerts       Alert[]
  createdAt    DateTime      @default(now())
}

model RequestLog {
  id           String   @id @default(cuid())
  projectId    String
  project      Project  @relation(fields: [projectId], references: [id])
  method       String
  route        String
  statusCode   Int
  responseTime Int      // milliseconds
  timestamp    DateTime
  // TimescaleDB hypertable on timestamp column
}

model ErrorEvent {
  id          String   @id @default(cuid())
  projectId   String
  project     Project  @relation(fields: [projectId], references: [id])
  message     String
  stack       String?
  route       String
  statusCode  Int
  count       Int      @default(1)
  firstSeen   DateTime
  lastSeen    DateTime
}

model UptimeCheck {
  id           String   @id @default(cuid())
  projectId    String
  url          String
  status       String   // "up" | "down"
  responseTime Int?     // ms
  checkedAt    DateTime
}

model Alert {
  id          String  @id @default(cuid())
  projectId   String
  type        String  // "error_rate" | "latency" | "uptime"
  threshold   Float
  channel     String  // "email" | "slack"
  destination String  // email address or Slack webhook URL
  active      Boolean @default(true)
}

enum Plan {
  FREE
  STARTER
  PRO
  ENTERPRISE
}
```

---

## Monetization Tiers

| Plan | Price | Requests/mo | Projects | Retention |
|------|-------|-------------|----------|-----------|
| Free | $0 | 50,000 | 1 | 24 hours |
| Starter | $19/mo | 1,000,000 | 3 | 7 days |
| Pro | $79/mo | 10,000,000 | Unlimited | 30 days |
| Enterprise | Custom | Custom | Unlimited | Custom |

- Billing via **Stripe metered billing** — usage tracked per project per billing period.
- Free tier hitting 50k limit → ingestion API returns **HTTP 402**.
- Data retention enforced via **TimescaleDB retention policies**, not manual deletes.

---

## Build Phases — Current Status

### ✅ Phase 0 — Planning (DONE)
Architecture defined, stack chosen, data models designed.

### 🔨 Phase 1 — Ingestion Core (START HERE)
- [ ] Fastify ingestion server (`apps/api`)
- [ ] PostgreSQL + TimescaleDB setup
- [ ] Prisma schema + migrations
- [ ] API key generation + SHA-256 hashing
- [ ] `POST /ingest` endpoint — validates key, queues event
- [ ] Redis + BullMQ setup
- [ ] Worker that dequeues and writes `RequestLog` to TimescaleDB
- [ ] Rate limiting on ingestion endpoint
- [ ] Basic health check endpoint `GET /health`

### 📋 Phase 2 — Dashboard Foundation
- Next.js 14 App Router setup
- Clerk auth (sign up / sign in)
- Project CRUD + API key generation UI
- Request log table with filtering
- Polling-based live feed (3s interval)

### 📋 Phase 3 — Analytics & Metrics
- TimescaleDB continuous aggregates: P50/P90/P99 per endpoint
- Error grouping + deduplication
- Recharts: request volume, error rate, latency over time
- Time range selector: 1h / 6h / 24h / 7d

### 📋 Phase 4 — Alerting & Uptime
- BullMQ repeatable job: uptime ping every 60s
- Alert rule creation UI
- Resend email + Slack webhook delivery
- Alert history log

### 📋 Phase 5 — SDK Polish
- Clean `@pulse/node` package
- Express middleware + Fastify plugin
- Batching: flush every 500ms or 10 events
- Strip sensitive headers automatically
- README quick-start

### 📋 Phase 6 — Billing
- Stripe product + metered price setup
- Usage reporting from worker to Stripe
- Upgrade/downgrade UI
- Stripe webhook handler
- Plan enforcement in ingestion API

---

## Non-Negotiables (Never Violate These)

1. **Ingestion API p99 < 50ms** — queue immediately, never do DB writes in the request path.
2. **API keys are always hashed** (SHA-256) before storage — never store or log the raw key.
3. **All data scoped to project** — a request with API key X must never read or write project Y's data.
4. **No raw request bodies stored** — only metadata (method, route, status, response time).
5. **SDK never throws, never blocks** — if Pulse is down, the user's app must still work perfectly.
6. **GDPR compliance** — project deletion cascades to all logs, errors, and checks. Users can wipe their data.
7. **Sensitive headers stripped** — `Authorization`, `Cookie`, `X-Api-Key` never leave the user's server.

---

## SDK Behaviour Reference

```ts
// What the developer writes — nothing more
import { pulse } from '@pulse/node'
app.use(pulse({ apiKey: 'pk_live_...' }))

// What happens internally (simplified)
function pulseMiddleware(config) {
  return (req, res, next) => {
    const start = Date.now()
    res.on('finish', () => {
      const event = {
        method: req.method,
        route: req.route?.path || req.path,
        statusCode: res.statusCode,
        responseTime: Date.now() - start,
        timestamp: new Date().toISOString(),
      }
      buffer.push(event)  // fire-and-forget, never awaited
    })
    next()
  }
}
// Buffer flushes every 500ms OR when it hits 10 events
```

---

## Key API Contracts

### `POST /ingest`
- Auth: `Authorization: Bearer pk_live_...` (raw key, validated by hash comparison)
- Body:
  ```ts
  {
    events: Array<{
      method: string
      route: string
      statusCode: number
      responseTime: number
      timestamp: string // ISO 8601
    }>
  }
  ```
- Response: `{ success: true }` — always fast, processing is async
- Errors: `401` (bad key), `402` (plan limit hit), `429` (rate limited)

### `GET /health`
- No auth
- Response: `{ status: "ok", ts: "<ISO timestamp>" }`

---

## Important Decisions Made

- **Fastify over Express** for ingestion — benchmarks significantly faster, built-in schema validation.
- **BullMQ over direct DB writes** — keeps ingestion under 50ms even under load.
- **TimescaleDB over InfluxDB/ClickHouse** — stays in the Postgres ecosystem, Prisma compatible, easier ops.
- **Clerk over Auth.js** — faster to ship, handles sessions/JWTs/OAuth out of the box.
- **SHA-256 over bcrypt for API keys** — API keys are long random strings (high entropy), bcrypt's cost is unnecessary and adds latency; SHA-256 is fine here.
- **Polling over WebSockets for live feed** — simpler infra, 3s delay acceptable for MVP.

---

## What "Done" Looks Like

- A developer signs up, installs `@pulse/node`, and sees their **first request log within 5 minutes**.
- Real teams paying **$19-79/month**.
- Ingestion handles **1,000 req/sec** without dropping events.
- Dashboard feels **fast and trustworthy** — not a toy side project.