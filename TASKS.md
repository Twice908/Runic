# Pulse — Task Tracker

> Claude updates this file at the end of every session. Check here before starting work to know exactly where things stand.

---

## ✅ Phase 0 — Planning (COMPLETE)

- [x] Architecture defined (Fastify → Redis → BullMQ → TimescaleDB + PostgreSQL)
- [x] Tech stack chosen and documented in `CLAUDE.project.md`
- [x] All Prisma data models designed
- [x] Monetization tiers defined ($0 / $19 / $79 / Custom)

---

## ✅ Phase 1a — Monorepo Boilerplate (COMPLETE)

Everything below is written, installed, and passes `tsc --noEmit` with zero errors.

### Root
- [x] `package.json` — npm workspaces root (`apps/*`, `packages/*`)
- [x] `turbo.json` — Turborepo pipeline (build → dev → lint → test)
- [x] `tsconfig.base.json` — strict TypeScript base all packages extend
- [x] `.gitignore` — Node, Next.js, env files, build artifacts, `.claude/`
- [x] `.env.example` — all required env vars documented

### `packages/db`
- [x] Prisma schema with all 6 models: `User`, `Project`, `RequestLog`, `ErrorEvent`, `UptimeCheck`, `Alert` + `Plan` enum
- [x] `src/index.ts` — exports singleton `PrismaClient`
- [x] `prisma generate` run — client generated into `node_modules`

### `packages/types`
- [x] Shared TypeScript interfaces: `IngestEvent`, `IngestPayload`, `ApiResponse`, `PlanType`, `AlertType`, `AlertChannel`

### `apps/api` (Fastify Ingestion API)
- [x] Fastify server entry (`src/index.ts`) — registers plugins + routes
- [x] `src/env.ts` — zod-validated env vars
- [x] Plugins: `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit`
- [x] `GET /health` — returns `{ status: "ok", ts: "<ISO>" }`
- [x] `POST /ingest` — stub: validates Bearer token present + Zod-validates body, enqueues job, returns `{ success: true }`
- [x] `src/lib/redis.ts` — IORedis client (lazy connect)
- [x] `src/lib/queue.ts` — BullMQ `ingestQueue` setup

### `apps/worker` (BullMQ Worker)
- [x] Worker entry (`src/index.ts`) — listens on `ingest` queue, logs completed/failed
- [x] `src/env.ts` — zod-validated env vars
- [x] `src/processors/ingest.processor.ts` — stub processor (logs job, ready for DB writes)

### `apps/web` (Next.js 14 Dashboard)
- [x] App Router setup with Tailwind CSS
- [x] `app/layout.tsx` — root layout with `ClerkProvider`
- [x] `app/page.tsx` — landing page, redirects authenticated users to `/dashboard`
- [x] `app/(auth)/sign-in/page.tsx` — Clerk `<SignIn />` component
- [x] `app/(auth)/sign-up/page.tsx` — Clerk `<SignUp />` component
- [x] `app/dashboard/page.tsx` — protected stub ("Dashboard coming soon")
- [x] `middleware.ts` — Clerk middleware protecting `/dashboard/*`

---

## 🔨 Phase 1b — Ingestion Core (NEXT UP)

These are the remaining Phase 1 items. Start here next session.

### Database
- [ ] Provision TimescaleDB (PostgreSQL + extension) — local Docker or Railway
- [ ] Run `prisma migrate dev` to create tables
- [ ] Enable TimescaleDB hypertable on `RequestLog.timestamp`

### API Key System
- [ ] `POST /projects` — create project, generate API key (`pk_live_` prefix + 32 random bytes)
- [ ] Hash API key with SHA-256 before storing — store `apiKeyHash` + `apiKeyPrefix` (first 8 chars)
- [ ] Return the raw key **once** to the user (never again)
- [ ] `src/lib/api-key.ts` — `generateApiKey()` and `hashApiKey()` helpers

### `POST /ingest` — Real Implementation
- [ ] Look up project by hashing the Bearer token and comparing to `apiKeyHash`
- [ ] Return `401` if key not found
- [ ] Check project's plan against usage — return `402` if limit exceeded
- [ ] Enqueue validated events with `projectId` attached to the job

### Worker — Real DB Writes
- [ ] `ingest.processor.ts` — write each event as a `RequestLog` row via Prisma
- [ ] Handle duplicate/idempotency edge cases
- [ ] Add structured error handling (failed jobs should log full context)

### Rate Limiting
- [ ] Wire `@fastify/rate-limit` to Redis (already set up, needs Redis running)
- [ ] Per-API-key rate limiting, not just per-IP

---

## 📋 Phase 2 — Dashboard Foundation

- [ ] Next.js API routes for fetching `RequestLog` data (scoped to authenticated user's projects)
- [ ] Project CRUD UI — create project, view API key prefix, copy key on creation
- [ ] Request log table with pagination and status code filtering
- [ ] 3-second polling live feed
- [ ] Clerk webhook → create `User` row in DB on first sign-up

---

## 📋 Phase 3 — Analytics & Metrics

- [ ] TimescaleDB continuous aggregates: P50 / P90 / P99 per endpoint per hour
- [ ] Error grouping + deduplication (group by `message` + `route`)
- [ ] Recharts: request volume, error rate, latency over time
- [ ] Time range selector: 1h / 6h / 24h / 7d

---

## 📋 Phase 4 — Alerting & Uptime

- [ ] BullMQ repeatable job: uptime ping every 60s, write `UptimeCheck`
- [ ] Alert rule creation UI (type, threshold, channel, destination)
- [ ] Resend email delivery for `email` channel alerts
- [ ] Slack webhook delivery for `slack` channel alerts
- [ ] Alert history log in dashboard

---

## 📋 Phase 5 — SDK (`@pulse/node`)

- [ ] `packages/sdk/` — Express middleware + Fastify plugin
- [ ] Batching: flush buffer every 500ms or when it hits 10 events
- [ ] Strip sensitive headers: `Authorization`, `Cookie`, `X-Api-Key`
- [ ] Never throw, never block — all errors caught internally
- [ ] Publish to npm as `@pulse/node`
- [ ] README quick-start guide

---

## 📋 Phase 6 — Billing (Stripe)

- [ ] Stripe product + metered price setup (per-request billing)
- [ ] Worker reports usage to Stripe after each batch processed
- [ ] Upgrade/downgrade UI in dashboard
- [ ] Stripe webhook handler (payment failed → downgrade plan)
- [ ] Plan enforcement in ingestion API (check usage before enqueuing)

---

## Notes

- **Run order for local dev**: start Redis → start Postgres/TimescaleDB → `npm run dev` from root
- **Type-check**: build packages first (`cd packages/types && npx tsc && cd ../db && npx tsc`), then `npx tsc --noEmit` in each app
- **API key format**: `pk_live_<32 random hex chars>` — store only the SHA-256 hash, never the raw key
