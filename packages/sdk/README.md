# @runic/node

[![npm version](https://img.shields.io/npm/v/@runic/node)](https://www.npmjs.com/package/@runic/node)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Lightweight observability SDK for Node.js backends. Drop one line into any Express or Fastify app and get real-time request logs, error tracking, and latency monitoring in your [Runic](https://runic.dev) dashboard.

---

## Installation

```bash
npm install @runic/node
```

No additional `@types` package needed — TypeScript types are included.

---

## Express quickstart

```js
import { runic } from '@runic/node'

app.use(runic({ apiKey: 'pk_live_...' }))
```

That's it. Every request your app handles is now tracked in Runic.

---

## Fastify quickstart

```js
import { runicPlugin } from '@runic/node'

await fastify.register(runicPlugin, { apiKey: 'pk_live_...' })
```

---

## Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | **required** | Your Runic API key (from the dashboard) |
| `host` | `string` | `https://api.runic.dev` | Runic API base URL. Override for self-hosted instances |
| `timeout` | `number` | `5000` | Request timeout in milliseconds |
| `debug` | `boolean` | `false` | Log every send attempt and result to the console |
| `ignoreRoutes` | `string[]` | `[]` | Route prefixes to skip (e.g. `['/health', '/metrics']`) |
| `ignoreMethods` | `string[]` | `[]` | HTTP methods to skip (e.g. `['OPTIONS']`) |
| `captureBody` | `boolean` | `false` | Capture sanitized request body (sensitive fields are redacted) |
| `captureHeaders` | `boolean` | `false` | Capture sanitized request headers (auth headers are always removed) |

---

## Ignoring routes

```js
runic({
  apiKey: 'pk_live_...',
  ignoreRoutes: ['/health', '/metrics', '/favicon.ico'],
  ignoreMethods: ['OPTIONS'],
})
```

---

## Capturing errors manually

Use `captureError` to track errors that don't result in an HTTP response — background jobs, cron tasks, queue processors:

```js
import { captureError } from '@runic/node'

try {
  await processJob()
} catch (err) {
  captureError(err, { route: '/jobs/process', method: 'WORKER' })
}
```

---

## Environment variable override

Set the Runic API host via environment variable instead of config:

```
RUNIC_HOST=https://api.yourdomain.com
```

This is useful for self-hosted Runic instances or different environments without changing code:

```js
// This also works — config.host takes precedence over the env var
runic({ apiKey: 'pk_live_...', host: 'https://your-runic-api.com' })
```

---

## Rate Limiting

Protect your API routes with a single line. Rules are managed in the Runic dashboard and go live within 30 seconds — no redeploy needed.

### Express

```js
import { runic, rateLimit } from '@runic/node'

app.use(runic({ apiKey: 'pk_live_...' }))
app.use(rateLimit({ rules: 'auto' }))
```

### Fastify

```js
import { runicPlugin, rateLimitPlugin } from '@runic/node'

await fastify.register(runicPlugin, { apiKey: 'pk_live_...' })
await fastify.register(rateLimitPlugin, { rules: 'auto' })
```

### Manual rules (local dev)

When `RATE_LIMITER_URL` is not set, the middleware allows all traffic silently — safe for local development. To test rate limiting locally, pass rules directly:

```js
app.use(rateLimit({
  rules: [{ path: '/api/login', limit: 5, window: '1m', key: 'ip' }]
}))
```

### Environment variables (required for `rules: 'auto'`)

```
# Rate-limiter service URL
RATE_LIMITER_URL=http://localhost:3002          # dev
RATE_LIMITER_URL=https://rate-limiter.example.com  # prod

# Your Runic project ID (from the dashboard)
RUNIC_PROJECT_ID=proj_xxx

# Your Runic project API key
RUNIC_API_KEY=pk_live_xxx

# Internal token for fetching rules (from the dashboard → Settings)
RATE_LIMITER_INTERNAL_TOKEN=your_internal_token
```

### `rateLimit` options

| Option | Type | Default | Description |
|---|---|---|---|
| `rules` | `'auto' \| RateLimitRule[]` | **required** | `'auto'` fetches rules from Runic; pass an array to override |
| `failOpen` | `boolean` | `true` | If `true`, allows traffic when Runic is unreachable. **Never set to `false` in production.** |
| `onLimited` | `(ctx) => void` | — | Called when a request is rate-limited, before the 429 is sent |
| `headerPrefix` | `string` | `'X-RateLimit'` | Prefix for RFC 6585 response headers |

### Fail-open guarantee

If the Runic rate-limiter service is unreachable, times out (>10ms), or returns a 5xx error, the middleware **always allows the request through** when `failOpen: true` (the default). Your app is never affected by a Runic outage.

---

## What data is collected

**Collected for every request:**
- HTTP method (`GET`, `POST`, etc.)
- Matched route pattern (`/users/:id`, not the raw path `/users/123`)
- Response status code
- Response time in milliseconds
- Timestamp

**Never collected:**
- `Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`, and other auth headers
- Request or response bodies (unless `captureBody: true` is set)
- Fields named `password`, `secret`, `token`, `apiKey`, `creditCard`, `ssn`, or `cvv` (replaced with `[redacted]`)
- Raw URL path parameters — only the route pattern is stored

---

## Graceful shutdown

The SDK automatically flushes any buffered events when your process receives `SIGTERM` or `SIGINT`. No extra code needed.

---

## Self-hosted Runic

If you're running your own Runic instance, pass the `host` option:

```js
runic({
  apiKey: 'pk_live_...',
  host: 'https://runic-api.internal.yourcompany.com',
})
```

---

## How it works

The SDK adds zero latency to your request/response cycle. Here's what happens:

1. On each request, `Date.now()` is recorded before your handlers run
2. After the response is sent, response time is calculated and an event is added to an in-memory buffer
3. The buffer flushes every **500ms** or when it reaches **10 events** — whichever comes first
4. Events are sent in a single batch POST to `/ingest` — completely asynchronous, never awaited in the request path
5. If the Runic API is unreachable, events are silently dropped — your app is never affected
