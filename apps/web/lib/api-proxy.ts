import { NextResponse } from 'next/server'

const API_UNREACHABLE = NextResponse.json(
  { error: 'API server unreachable. Is apps/api running on port 3001?' },
  { status: 503 },
)

const RL_UNREACHABLE = NextResponse.json(
  { error: 'Rate Limiter service unreachable. Is apps/rate-limiter running on port 3002?' },
  { status: 503 },
)

const DRIFT_UNREACHABLE = NextResponse.json(
  { error: 'Drift collector unreachable. Is apps/drift-detector running on port 3003?' },
  { status: 503 },
)

export async function proxyToApi(
  path: string,
  token: string,
  options?: { method?: string; body?: string },
): Promise<NextResponse> {
  const apiUrl = process.env['INGESTION_API_URL'] ?? 'http://localhost:3001'
  let res: Response
  try {
    res = await fetch(`${apiUrl}${path}`, {
      method: options?.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      ...(options?.body ? { body: options.body } : {}),
    })
  } catch {
    return API_UNREACHABLE
  }
  if (res.status === 204) return new NextResponse(null, { status: 204 })
  const text = await res.text()
  if (!text) {
    return NextResponse.json(
      { success: false, error: { code: 'BAD_GATEWAY', message: 'API server returned an empty response' } },
      { status: 502 },
    )
  }
  try {
    return NextResponse.json(JSON.parse(text), { status: res.status })
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'BAD_GATEWAY', message: 'API server returned an invalid response' } },
      { status: 502 },
    )
  }
}

/**
 * Proxy to the Rate Limiter service (apps/rate-limiter, default port 3002).
 * Uses RATE_LIMITER_INTERNAL_TOKEN for auth — never a user Clerk JWT.
 * Caller must already have verified the user is authenticated with Clerk.
 */
export async function proxyToRateLimiter(
  path: string,
  options?: { method?: string; body?: string },
): Promise<NextResponse> {
  const rlUrl = process.env['RATE_LIMITER_URL'] ?? 'http://localhost:3002'
  const token = process.env['RATE_LIMITER_INTERNAL_TOKEN'] ?? ''
  let res: Response
  try {
    res = await fetch(`${rlUrl}${path}`, {
      method: options?.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      ...(options?.body ? { body: options.body } : {}),
    })
  } catch {
    return RL_UNREACHABLE
  }
  if (res.status === 204) return new NextResponse(null, { status: 204 })
  const text = await res.text()
  if (!text) {
    return NextResponse.json(
      { success: false, error: { code: 'BAD_GATEWAY', message: 'Rate limiter returned an empty response' } },
      { status: 502 },
    )
  }
  try {
    return NextResponse.json(JSON.parse(text), { status: res.status })
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'BAD_GATEWAY', message: 'Rate limiter returned an invalid response' } },
      { status: 502 },
    )
  }
}

/**
 * Proxy to the Drift collector service (apps/drift-detector, default port 3003).
 * Uses DRIFT_INTERNAL_TOKEN for auth — never a user Clerk JWT.
 * Forwards the user's Clerk session cookie so the collector can resolve
 * user identity for session-authed endpoints.
 * Caller must already have verified the user is authenticated with Clerk.
 */
export async function proxyToDrift(
  path: string,
  options?: { method?: string; body?: string; cookie?: string },
): Promise<NextResponse> {
  const driftUrl = process.env['DRIFT_COLLECTOR_URL'] ?? 'http://localhost:3003'
  const token = process.env['DRIFT_INTERNAL_TOKEN'] ?? ''
  let res: Response
  try {
    res = await fetch(`${driftUrl}${path}`, {
      method: options?.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options?.cookie ? { Cookie: options.cookie } : {}),
      },
      ...(options?.body ? { body: options.body } : {}),
    })
  } catch {
    return DRIFT_UNREACHABLE
  }
  if (res.status === 204) return new NextResponse(null, { status: 204 })
  const text = await res.text()
  if (!text) {
    return NextResponse.json(
      { success: false, error: { code: 'BAD_GATEWAY', message: 'Drift collector returned an empty response' } },
      { status: 502 },
    )
  }
  try {
    return NextResponse.json(JSON.parse(text), { status: res.status })
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'BAD_GATEWAY', message: 'Drift collector returned an invalid response' } },
      { status: 502 },
    )
  }
}
