# SDK Test App

A minimal Express server for testing `@runic/node` against a local Runic stack.

## Prerequisites

The full Runic stack must be running:

```bash
# From the monorepo root
docker compose up -d
npm run dev
```

## Setup

```bash
# 1. Build the SDK
cd packages/sdk && npm run build

# 2. Install test-app dependencies
cd test-app && npm install

# 3. Set your API key (get one from http://localhost:3000/dashboard)
export RUNIC_API_KEY=pk_live_...

# 4. Start the test app
node index.js
```

## Fire test requests

```bash
# 200 OK
curl http://localhost:4000/test/success

# 200 OK after 800ms delay (tests latency detection)
curl http://localhost:4000/test/slow

# 500 error
curl http://localhost:4000/test/error

# 404
curl http://localhost:4000/test/not-found

# 201 with body
curl -X POST http://localhost:4000/test/data \
  -H "Content-Type: application/json" \
  -d '{"name":"test","value":42}'
```

After firing requests, open your Runic dashboard at **http://localhost:3000/dashboard** and watch the logs appear in real time.
