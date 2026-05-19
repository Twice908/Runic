# @pulse/node

[![npm version](https://img.shields.io/npm/v/@pulse/node)](https://www.npmjs.com/package/@pulse/node)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Lightweight observability SDK for Node.js backends. Drop one line into any Express or Fastify app and get real-time request logs, error tracking, and latency monitoring in your [Pulse](https://pulse.dev) dashboard.

---

## Installation

```bash
npm install @pulse/node
```

No additional `@types` package needed — TypeScript types are included.

---

## Express quickstart

```js
import { pulse } from '@pulse/node'

app.use(pulse({ apiKey: 'pk_live_...' }))
```

That's it. Every request your app handles is now tracked in Pulse.

---

## Fastify quickstart

```js
import { pulsePlugin } from '@pulse/node'

await fastify.register(pulsePlugin, { apiKey: 'pk_live_...' })
```

---

## Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | **required** | Your Pulse API key (from the dashboard) |
| `host` | `string` | `https://api.pulse.dev` | Pulse API base URL. Override for self-hosted instances |
| `timeout` | `number` | `5000` | Request timeout in milliseconds |
| `debug` | `boolean` | `false` | Log every send attempt and result to the console |
| `ignoreRoutes` | `string[]` | `[]` | Route prefixes to skip (e.g. `['/health', '/metrics']`) |
| `ignoreMethods` | `string[]` | `[]` | HTTP methods to skip (e.g. `['OPTIONS']`) |
| `captureBody` | `boolean` | `false` | Capture sanitized request body (sensitive fields are redacted) |
| `captureHeaders` | `boolean` | `false` | Capture sanitized request headers (auth headers are always removed) |

---

## Ignoring routes

```js
pulse({
  apiKey: 'pk_live_...',
  ignoreRoutes: ['/health', '/metrics', '/favicon.ico'],
  ignoreMethods: ['OPTIONS'],
})
```

---

## Capturing errors manually

Use `captureError` to track errors that don't result in an HTTP response — background jobs, cron tasks, queue processors:

```js
import { captureError } from '@pulse/node'

try {
  await processJob()
} catch (err) {
  captureError(err, { route: '/jobs/process', method: 'WORKER' })
}
```

---

## Environment variable override

Set the Pulse API host via environment variable instead of config:

```
PULSE_HOST=https://api.yourdomain.com
```

This is useful for self-hosted Pulse instances or different environments without changing code:

```js
// This also works — config.host takes precedence over the env var
pulse({ apiKey: 'pk_live_...', host: 'https://your-pulse-api.com' })
```

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

## Self-hosted Pulse

If you're running your own Pulse instance, pass the `host` option:

```js
pulse({
  apiKey: 'pk_live_...',
  host: 'https://pulse-api.internal.yourcompany.com',
})
```

---

## How it works

The SDK adds zero latency to your request/response cycle. Here's what happens:

1. On each request, `Date.now()` is recorded before your handlers run
2. After the response is sent, response time is calculated and an event is added to an in-memory buffer
3. The buffer flushes every **500ms** or when it reaches **10 events** — whichever comes first
4. Events are sent in a single batch POST to `/ingest` — completely asynchronous, never awaited in the request path
5. If the Pulse API is unreachable, events are silently dropped — your app is never affected
