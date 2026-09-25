# Runic

> Backend observability for solo developers and small teams — without the Datadog price tag.

Drop one line into any Express or Fastify app. Get real-time request logs, error tracking, slow endpoint detection, and uptime alerts. Pay $20–80/month instead of hundreds.

---

## The Problem

You ship a backend on Railway or Render. Something breaks in production. You find out from an angry user. You have no idea what happened, when it started, or which endpoint is slow. Datadog costs $300/month before you've made a dollar.

Runic fixes this for indie devs and small teams.

---

## How It Works

```
Your Backend (Express / Fastify)
        │
        │  SDK fires async HTTP — never blocks your request
        ▼
┌──────────────────────────────┐
│  Ingestion API (Fastify)     │  <50ms p99, API key auth, rate limiter
│  POST /ingest                │  → plan limit check → BullMQ addBulk
│  Rate limit: 100 req / 10s  │  keyed per API key fingerprint (Redis)
└────────────┬─────────────────┘
             ▼
┌──────────────────┐
│   Redis Queue    │  BullMQ — decouples ingestion from DB writes
└────────┬─────────┘
         ▼
┌──────────────────┐
│  Worker Service  │  Processes logs, groups errors, computes metrics,
│                  │  evaluates alert rules, fires uptime pings
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
| Rate Limiter | **`@fastify/rate-limit`** — Redis-backed, per API key |
| Metrics DB | **TimescaleDB** (PostgreSQL extension) |
| App DB | **PostgreSQL** + **Prisma ORM** |
| Dashboard | **Next.js 14** App Router + **Tailwind CSS** |
| Auth | **Clerk** |
| Billing | **Stripe** (metered usage-based) — Phase 6 |
| Email Alerts | **Resend** |
| Slack Alerts | Slack Webhooks |
| SDK | **`@runic/node`** npm package |
| Monorepo | **Turborepo** + npm workspaces |

---

## Monorepo Structure

```
runic/
├── apps/
│   ├── api/              Fastify ingestion + REST API          :3001
│   ├── worker/           BullMQ worker — processes log queue
│   └── web/              Next.js 14 dashboard                  :3000
├── packages/
│   ├── db/               Prisma schema + shared PrismaClient
│   ├── sdk/              @runic/node — Express + Fastify middleware
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
git clone https://github.com/<your-username>/runic.git
cd runic
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in your values — see .env.example for descriptions
```

### 3. Start infrastructure (Docker)

```bash
docker compose up -d   # starts TimescaleDB + Redis from docker-compose.yml
```

### 4. Set up the database

```bash
cd packages/db
npx prisma migrate dev --name init
npx prisma db execute --file ./prisma/timescale-setup.sql --schema ./prisma/schema.prisma
```

### 5. Run the monorepo

```bash
# All apps at once (Turborepo)
npm run dev

# Or individually:
npm run dev -w @runic/api       # Fastify API  → http://localhost:3001
npm run dev -w @runic/worker    # BullMQ worker
npm run dev -w @runic/web       # Next.js UI   → http://localhost:3000
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

### Rate Limiter

All API routes are protected by a global Redis-backed rate limiter (`@fastify/rate-limit`):

| Setting | Value |
|---------|-------|
| Window | 10 seconds |
| Max requests | 100 per window |
| Key | First 16 chars of API key (`rl:key:<fingerprint>`), or IP (`rl:ip:<addr>`) |
| Storage | Redis (same instance as BullMQ) |
| Bypass | Routes can opt out via `{ config: { rateLimit: false } }` — used by `POST /webhooks/clerk` |

When the limit is exceeded the API returns `429 Too Many Requests`. The limit is currently plan-agnostic — all tiers share the same 100/10s ceiling. Per-plan rate limits (higher for Pro/Enterprise) are planned for Phase 6 alongside Stripe integration.

---

## SDK Usage

```ts
import { runic } from '@runic/node'

// Express
app.use(runic({ apiKey: 'pk_live_...' }))

// Fastify
app.register(runic, { apiKey: 'pk_live_...' })
```

The SDK is fire-and-forget — it never blocks your request, never throws, and buffers events (flushes every 500ms or 10 events). If Runic is down, your app keeps working.

### Config options

| Option | Default | Description |
|--------|---------|-------------|
| `apiKey` | required | Your project API key |
| `endpoint` | `https://api.userunic.dev` | Override for self-hosted or local dev |
| `ignoreRoutes` | `[]` | Route patterns to skip (e.g. `/health`) |
| `ignoreMethods` | `[]` | HTTP methods to skip (e.g. `OPTIONS`) |

### Build and publish SDK

```bash
cd packages/sdk
npm run build          # compiles src/ → dist/
npm publish --dry-run  # preview what gets uploaded
npm publish --access public
```

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
| 1b | Ingestion Core (API key auth, rate limiting, real DB writes) | ✅ Complete |
| 2 | Dashboard Foundation (project CRUD, log table, live feed) | ✅ Complete |
| 3 | Analytics & Metrics (TimescaleDB aggregates, Recharts charts) | ✅ Complete |
| 4 | Alerting & Uptime (Resend, Slack, repeatable BullMQ jobs) | ✅ Complete |
| 5 | SDK (`@runic/node` npm package — Express + Fastify) | ✅ Complete |
| 6 | Billing (Stripe metered, plan enforcement, per-plan rate limits) | 📋 Planned |

See [TASKS.md](./TASKS.md) for the detailed checklist of every task within each phase.

---

## Security Principles

- API keys are **SHA-256 hashed** before storage — the raw key is shown once and never stored.
- **No request bodies stored** — only metadata (method, route, status, response time).
- All data is **scoped to a project** — one API key can never read another project's data.
- **Sensitive headers stripped** by the SDK (`Authorization`, `Cookie`, `X-Api-Key`).
- GDPR: project deletion cascades to all logs, errors, and checks.
- Clerk webhook signatures verified via **svix** before any DB write.

---

## Contributing

This is a private project. See `CLAUDE.project.md` and `CLAUDE.system.md` for architecture decisions and coding standards.
