const express = require('express')
const { runic } = require('@runic/node')

const app = express()
const PORT = 4000

// Replace with your actual API key from the Runic dashboard.
// Get one at http://localhost:3000/dashboard after running the full stack.
const API_KEY = 'pk_live_48a2005bd20bc4c07bb8b0ee97eacea789c6457f3b4d1e2f5d5f1beb86deba10'

app.use(express.json())

app.use(
  runic({
    apiKey: API_KEY,
    host: 'http://localhost:3001',
    debug: true,
    ignoreRoutes: ['/favicon.ico'],
  }),
)

app.get('/test/success', (req, res) => {
  console.log('[test-app] GET /test/success')
  res.json({ ok: true, message: 'Everything is fine' })
})

app.get('/test/slow', async (req, res) => {
  console.log('[test-app] GET /test/slow — waiting 800ms')
  await new Promise((resolve) => setTimeout(resolve, 800))
  res.json({ ok: true, message: 'Slow response (800ms)' })
})

app.get('/test/error', (req, res) => {
  console.log('[test-app] GET /test/error')
  res.status(500).json({ ok: false, error: 'Internal server error' })
})

app.get('/test/not-found', (req, res) => {
  console.log('[test-app] GET /test/not-found')
  res.status(404).json({ ok: false, error: 'Not found' })
})

app.post('/test/data', (req, res) => {
  console.log('[test-app] POST /test/data', req.body)
  res.status(201).json({ ok: true, received: req.body })
})

app.listen(PORT, () => {
  console.log(`[test-app] Listening on http://localhost:${PORT}`)
  console.log(`[test-app] Sending events to Runic API at http://localhost:3001`)
  console.log(`[test-app] Using API key: ${API_KEY.slice(0, 12)}...`)
})
