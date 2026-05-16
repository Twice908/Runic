# Pulse

> Backend observability for solo developers and small teams — without the Datadog price tag.

Drop one line into any Express or Fastify app. Get real-time request logs, error tracking, slow endpoint detection, and uptime alerts. Pay $20–80/month instead of hundreds.

---

## The Problem

You ship a backend on Railway or Render. Something breaks in production. You find out from an angry user. You have no idea what happened, when it started, or which endpoint is slow. Datadog costs $300/month before you've made a dollar.

Pulse fixes this for indie devs and small teams.

---

## How It Works

```
Your Backend (Express / Fastify)
        │
        │  SDK fires async HTTP — never blocks your request
        ▼
┌──────────────────┐
│  Ingestion API   │  Fastify, <50ms p99, API key auth
└────────┬─────────┘
         ▼
┌──────────────────┐
│   Redis Queue    │  BullMQ — decouples ingestion from DB writes
└────────┬─────────┘
         ▼
┌──────────────────┐
│  Worker Service  │  Processes logs, groups errors, computes metrics
└────────┬─────────┘
         ▼
   ┌─────┴──────────┐
   ▼                ▼
TimescaleDB      PostgreSQL
(RequestLog,     (User, Project,
 UptimeCheck)     Alert, ErrorEvent)
         │
         ▼
┌──────────────────┐
│  Next.js Dashboard│  Real-time polling, Recharts, Clerk auth
└──────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Ingestion API | Node.js 22 + **Fastify 4** |
| Queue | **Redis** + **BullMQ** |
| Metrics DB | **TimescaleDB** (PostgreSQL extension) |
| App DB | **PostgreSQL** + **Prisma ORM** |
| Dashboard | **Next.js 14** App Router + **Tailwind CSS** |
| Auth | **Clerk** |
| Billing | **Stripe** (metered usage-based) |
| Email Alerts | **Resend** |
| Slack Alerts | Slack Webhooks |
| SDK | **`@pulse/node`** npm package |
| Monorepo | **Turborepo** + npm workspaces |

---

## Monorepo Structure

```
pulse/
├── apps/
│   ├── api/              Fastify ingestion + REST API          :3001
│   ├── worker/           BullMQ worker — processes log queue
│   └── web/              Next.js 14 dashboard                  :3000
├── packages/
│   ├── db/               Prisma schema + shared PrismaClient
│   └── types/            Shared TypeScript interfaces
├── TASKS.md              ← Living task tracker (check this first)
├── turbo.json
├── package.json          npm workspaces root
├── tsconfig.base.json    strict TS base
└── .env.example          all required env vars
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- Docker (for local PostgreSQL + TimescaleDB + Redis)
- GitHub CLI (`gh`) for repo management

### 1. Clone and install

```bash
git clone https://github.com/<your-username>/pulse.git
cd pulse
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in your values — see .env.example for descriptions
```

### 3. Start infrastructure (Docker)

```bash
# PostgreSQL + TimescaleDB
docker run -d \
  --name pulse-db \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=pulse \
  -p 5432:5432 \
  timescale/timescaledb:latest-pg16

# Redis
docker run -d \
  --name pulse-redis \
  -p 6379:6379 \
  redis:7-alpine
```

### 4. Set up the database

```bash
# Generate Prisma client
cd packages/db && npx prisma generate

# Run migrations
npx prisma migrate dev --name init
```

### 5. Run the monorepo

```bash
# All apps at once (Turborepo)
npm run dev

# Or individually:
npm run dev -w @pulse/api       # Fastify API  → http://localhost:3001
npm run dev -w @pulse/worker    # BullMQ worker
npm run dev -w @pulse/web       # Next.js UI   → http://localhost:3000
```

---

## API Reference

### `GET /health`

No auth required.

```json
{ "status": "ok", "ts": "2026-05-16T10:00:00.000Z" }
```

### `POST /ingest`

Auth: `Authorization: Bearer <api_key>`

```json
{
  "events": [
    {
      "method": "GET",
      "route": "/api/users",
      "statusCode": 200,
      "responseTime": 43,
      "timestamp": "2026-05-16T10:00:00.000Z"
    }
  ]
}
```

Response: `{ "success": true }` — always fast, processing is async.

| Status | Meaning |
|--------|---------|
| `200` | Accepted and queued |
| `400` | Invalid request body |
| `401` | Missing or invalid API key |
| `402` | Plan request limit reached |
| `429` | Rate limited |

---

## SDK Usage (Phase 5)

```ts
import { pulse } from '@pulse/node'

// Express
app.use(pulse({ apiKey: 'pk_live_...' }))

// Fastify
app.register(pulse, { apiKey: 'pk_live_...' })
```

The SDK is fire-and-forget — it never blocks your request, never throws, and buffers events (flushes every 500ms or 10 events). If Pulse is down, your app keeps working.

---

## Pricing

| Plan | Price | Requests/mo | Projects | Retention |
|------|-------|-------------|----------|-----------|
| Free | $0 | 50,000 | 1 | 24 hours |
| Starter | $19/mo | 1,000,000 | 3 | 7 days |
| Pro | $79/mo | 10,000,000 | Unlimited | 30 days |
| Enterprise | Custom | Custom | Unlimited | Custom |

Billing via Stripe metered billing — you only pay for what you use.

---

## Build Phases

| Phase | Name | Status |
|-------|------|--------|
| 0 | Planning | ✅ Complete |
| 1a | Monorepo Boilerplate | ✅ Complete |
| 1b | Ingestion Core (API key auth, real DB writes) | 🔨 In Progress |
| 2 | Dashboard Foundation (project CRUD, log table, live feed) | 📋 Planned |
| 3 | Analytics & Metrics (TimescaleDB aggregates, Recharts) | 📋 Planned |
| 4 | Alerting & Uptime (Resend, Slack, repeatable jobs) | 📋 Planned |
| 5 | SDK Polish (`@pulse/node` npm package) | 📋 Planned |
| 6 | Billing (Stripe metered, plan enforcement) | 📋 Planned |

See [TASKS.md](./TASKS.md) for the detailed checklist of every task within each phase.

---

## Security Principles

- API keys are **SHA-256 hashed** before storage — the raw key is shown once and never stored.
- **No request bodies stored** — only metadata (method, route, status, response time).
- All data is **scoped to a project** — one API key can never read another project's data.
- **Sensitive headers stripped** by the SDK (`Authorization`, `Cookie`, `X-Api-Key`).
- GDPR: project deletion cascades to all logs, errors, and checks.

---

## Contributing

This is a private project. See `CLAUDE.project.md` and `CLAUDE.system.md` for architecture decisions and coding standards.
