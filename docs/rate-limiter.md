# Pulse Rate Limiter — Claude Code Project Memory

> **Context**: This file is the authoritative reference for Claude Code when building the
> Rate Limiter product line inside the Pulse monorepo. Pulse Observe (the first product) is
> already complete. Rate Limiter is additive — it shares infrastructure, never replaces it.
> Always read this file before generating any code, schema, or route related to rate limiting.

---

## 1. Where This Lives in the Monorepo

```
pulse/
├── apps/
│   ├── dashboard/          ← existing Next.js app — add /rate-limiter route group here
│   ├── observe/            ← existing, do not touch
│   └── rate-limiter/       ← NEW Fastify service (create from scratch)
├── packages/
│   ├── database/           ← shared Prisma — append new models here, never fork it
│   ├── queue/              ← shared BullMQ — reuse existing instance
│   ├── config/             ← shared env/config — add RL-specific vars here
│   └── sdk/                ← @pulse/node — add rateLimit() middleware here
```

**Rule**: Never duplicate shared packages. If `packages/database` already exports a Prisma
client, import it — don't instantiate a new one inside `apps/rate-limiter`.

---

## 2. Tech Decisions (locked, do not deviate)

| Concern | Choice | Notes |
|---|---|---|
| Enforcement service | Fastify | New `apps/rate-limiter` |
| Counter storage | Redis sliding window | Reuse existing Redis instance |
| Rule storage | PostgreSQL via Prisma | New tables on existing DB |
| SDK layer | `@pulse/node` or new `@pulse/rate-limiter` package | Exports `rateLimit()` |
| Dashboard | New route group in existing Next.js app | `/dashboard/rate-limiter/` |
| Async analytics | BullMQ (shared) | Enforcement itself is synchronous |
| Time-series events | TimescaleDB hypertable | `RateLimitEvent` table |

---

## 3. Data Models

### 3.1 Prisma — append to `packages/database/schema.prisma`

```prisma
model RateLimitRule {
  id             String   @id @default(cuid())
  projectId      String
  project        Project  @relation(fields: [projectId], references: [id])
  name           String
  pathPattern    String   // glob e.g. "/api/auth/*"
  limitKey       String   // "ip" | "apiKey" | "userId" | "global"
  limitKeyHeader String?  // header name when limitKey is "apiKey"
  limitCount     Int
  windowSecs     Int
  action         String   // "block" | "log_only"
  priority       Int      @default(0)
  enabled        Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([projectId, enabled])
}

model RateLimitEvent {
  id        String   @id @default(cuid())
  projectId String
  ruleId    String
  limitKey  String   // actual IP / key / userId — never PII like email/password
  path      String
  action    String   // "blocked" | "logged"
  timestamp DateTime @default(now())

  // TimescaleDB hypertable — partition key is timestamp
  @@index([projectId, timestamp])
  @@index([ruleId, timestamp])
}
```

After adding these models, run:
```bash
pnpm --filter @pulse/database prisma migrate dev --name add_rate_limiter
```

### 3.2 Redis Key Schema

```
rl:{projectId}:{ruleId}:{keyValue}:{windowSlot}   → INCR counter (atomic), EXPIRE = windowSecs
rl:rules:{projectId}                               → JSON string of active rules, TTL 30s
```

**Invariants**:
- Always namespace by `projectId` — never allow cross-project key access
- Never store request bodies, emails, or passwords as `keyValue`
- Use atomic `INCR + EXPIRE` — never read-modify-write (race condition)
- `windowSlot` = `Math.floor(Date.now() / 1000 / windowSecs)` for fixed window,
  or use sorted sets for true sliding window log

---

## 4. API Surface (`apps/rate-limiter` Fastify service)

### 4.1 Endpoints

```
POST   /v1/check
GET    /v1/rules/:projectId
POST   /v1/rules/:projectId
PATCH  /v1/rules/:ruleId
PUT    /v1/rules/:ruleId/toggle
GET    /v1/analytics/:projectId/events
```

### 4.2 `/v1/check` — the hot path

```ts
// Request
{
  projectId: string
  apiKey: string
  path: string
  method: string
  ip: string
  headers: Record<string, string>
}

// Response — allow
{
  allowed: true,
  rule: { id: string, limit: number, remaining: number, resetAt: number }
}

// Response — deny
{
  allowed: false,
  rule: { id: string, limit: number, remaining: number, resetAt: number },
  retryAfter: number  // seconds
}
```

**Performance contract**: p99 < 5ms. This means:
- No database reads on the hot path — rules come from Redis cache only
- If Redis cache miss → fetch from DB, populate cache (TTL 30s), then proceed
- No synchronous writes to Postgres on the hot path — all event writes go to BullMQ

### 4.3 Response Headers (RFC 6585 — required on every rate-limited response)

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 43
X-RateLimit-Reset: 1716230400    ← Unix timestamp
Retry-After: 60                  ← only on 429 responses
```

---

## 5. SDK Extension

### 5.1 File location
`packages/sdk/src/rate-limit.ts` (or `packages/rate-limiter/src/index.ts` if extracted)

### 5.2 Interface

```ts
export interface RateLimitRule {
  path: string
  limit: number
  window: string   // e.g. '1m', '30s', '1h'
  key: 'ip' | 'apiKey' | 'userId' | 'global'
  action?: 'block' | 'log_only'
}

export interface RateLimitOptions {
  rules: 'auto' | RateLimitRule[]
  failOpen?: boolean          // default: true — MUST default true, never false
  onLimited?: (ctx: LimitedContext) => void
  headerPrefix?: string       // default: 'X-RateLimit'
}
```

### 5.3 Developer usage

```js
import { pulse, rateLimit } from '@pulse/node'

app.use(pulse({ apiKey: 'pk_live_...' }))
app.use(rateLimit({ rules: 'auto' }))
```

Manual override for local dev:
```js
app.use(rateLimit({
  rules: [{ path: '/api/login', limit: 5, window: '1m', key: 'ip' }]
}))
```

### 5.4 Rule fetching strategy

1. On startup: fetch rules from `/v1/rules/:projectId` → cache in memory
2. Background refresh every 30 seconds
3. If user's backend has Redis access → do the counter check locally (faster)
4. If no Redis access → HTTP call to `/v1/check`
5. If Pulse is unreachable → **fail open** (let request through), log the error

**Hard limit**: The rate limit check must never delay a request by more than 10ms.
If the check exceeds this, abort and fail open.

---

## 6. Dashboard Routes

Add these under `apps/dashboard/app/dashboard/[projectId]/rate-limiter/`:

```
/overview        — hit rate chart, top blocked IPs, rule summary cards
/rules           — rule list with enable/disable toggle, edit, delete
/rules/new       — rule creation form with live preview of what would be blocked
/events          — live feed of rate limit events (mirror pattern from Observe's request logs)
/simulate        — (v2 only, skip for MVP) rule simulation against historical traffic
```

**UI patterns**: Follow the exact same component patterns, color tokens, and layout
conventions used in Pulse Observe's dashboard. Do not introduce new design systems.

---

## 7. Build Phases

### Phase RL-1 — Core enforcement (build first, everything depends on this)

- [ ] Redis sliding window counter — write tests before implementation
- [ ] Prisma schema additions + migration
- [ ] `apps/rate-limiter` Fastify service scaffolding
- [ ] `POST /v1/check` endpoint (hot path — no DB reads)
- [ ] Rule storage: `GET/POST /v1/rules/:projectId`
- [ ] Redis cache layer for rules (TTL 30s)
- [ ] SDK `rateLimit()` middleware
- [ ] RFC-compliant response headers

### Phase RL-2 — Dashboard

- [ ] Rule CRUD UI (`/rules`, `/rules/new`)
- [ ] Enable/disable toggle (instant, uses `PUT /v1/rules/:ruleId/toggle`)
- [ ] Basic event log table (`/events`)
- [ ] `/overview` summary cards

### Phase RL-3 — Analytics

- [ ] `RateLimitEvent` TimescaleDB hypertable setup
- [ ] BullMQ consumer writing events to TimescaleDB
- [ ] Per-rule charts: hit rate, block rate over time
- [ ] Top offenders view (IPs, API keys)
- [ ] Alert integration — reuse existing Pulse alert channels (email/Slack from Phase 4 of Observe)
  - Alert when a rule blocks > N requests in M minutes
  - Alert when a single IP hits > 90% of limit

### Phase RL-4 — Proxy Mode (build last, after SDK mode is stable)

- [ ] Standalone Fastify reverse proxy in `apps/rate-limiter` (separate entry point)
- [ ] DNS/CNAME setup instructions for users
- [ ] TLS termination via Let's Encrypt

---

## 8. Plan Limits (enforce at API and dashboard layer)

| Tier | Rules/project | Window precision | Proxy mode | Analytics retention |
|---|---|---|---|---|
| Free | 2 | Minute | No | 24h |
| Starter | 10 | Second | No | 7d |
| Pro | Unlimited | Second | Yes | 30d |
| Enterprise | Unlimited | Millisecond | Yes | Custom |

Billing: add meter `rate_limit_checks_monthly` to existing Stripe metered billing.
Do not create a new billing integration — extend the existing one.

---

## 9. Non-Negotiables (Claude Code must enforce these in every generated file)

| Rule | Detail |
|---|---|
| **Fail open** | If Pulse is unreachable, NEVER block user traffic. Always `failOpen: true` by default. |
| **Latency** | `/v1/check` p99 < 5ms. No DB on hot path. |
| **Atomic counters** | Use Redis `INCR + EXPIRE` only. No read-modify-write. |
| **Key isolation** | All Redis keys prefixed `rl:{projectId}:`. Cross-project access is a security bug. |
| **No PII in Redis** | `keyValue` = IP address, opaque API key, or user ID only. Never email, name, password. |
| **Instant rule changes** | Rule toggle must propagate within 30s (Redis TTL). No deploys needed. |
| **Idempotent rules** | Duplicate rule creation (same projectId + pathPattern + limitKey) must be rejected with 409. |
| **Never touch Observe** | Rate Limiter is additive. Do not modify existing Observe routes, models, or services. |

---

## 10. Environment Variables to Add to `packages/config`

```env
# Rate Limiter service
RATE_LIMITER_PORT=3002
RATE_LIMITER_INTERNAL_TOKEN=         # used by dashboard to call /v1/rules — generate with openssl rand -hex 32
RATE_LIMITER_REDIS_URL=              # if different from shared Redis, otherwise inherit from REDIS_URL
RATE_LIMITER_RULE_CACHE_TTL=30       # seconds — how long rules are cached in Redis
RATE_LIMITER_CHECK_TIMEOUT_MS=10     # abort check and fail open if exceeded
```

---

## 11. Testing Requirements

- Redis sliding window counter: unit tests covering window boundary conditions (requests
  at the exact start/end of a window must not be double-counted or dropped)
- `/v1/check`: integration test with a real Redis instance (use `ioredis-mock` for CI)
- SDK middleware: test fail-open behavior when Pulse service returns 5xx or times out
- Duplicate rule rejection: test the 409 response path
- Key isolation: test that `projectId` A cannot read or affect counters for `projectId` B

---

## 12. What Already Exists in Pulse Observe (do not rebuild)

When building Rate Limiter, these are available to import:

- `@pulse/database` — Prisma client, `Project` model (link `RateLimitRule.projectId` to this)
- `@pulse/queue` — BullMQ instance, queue factory helpers
- `@pulse/config` — env validation via Zod, shared config object
- Alert system — email and Slack alerting already built, find the alert service and call it
- Auth middleware — API key validation already exists, reuse it in `apps/rate-limiter`
- Dashboard layout — sidebar, nav, project switcher all exist; add rate-limiter nav item only

---

## 13. Definition of Done for MVP

- Developer adds `rateLimit({ rules: 'auto' })` and sees `/api/login` protected within 2 minutes
- Rule created in dashboard is live within 30 seconds (no redeploy)
- `/v1/check` benchmarks at 50,000 req/s on a single node (Redis is the bottleneck, not Fastify)
- Zero false positives from fail-open strategy
- All RFC 6585 headers present on every rate-limited response
- Proxy mode is NOT required for MVP — SDK mode alone ships first