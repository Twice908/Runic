import { headers } from 'next/headers'
import type { DriftEventsResponse, DriftMatrixResponse } from './types'

async function serverBaseUrl(): Promise<{ baseUrl: string; cookie: string }> {
  const h = await headers()
  const host = h.get('host') ?? 'localhost:3000'
  const protocol = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return { baseUrl: `${protocol}://${host}`, cookie: h.get('cookie') ?? '' }
}

export async function fetchMatrixServer(projectId: string): Promise<DriftMatrixResponse | null> {
  const { baseUrl, cookie } = await serverBaseUrl()
  const res = await fetch(`${baseUrl}/api/drift/matrix/${projectId}`, {
    headers: { cookie },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const json = (await res.json()) as { data?: DriftMatrixResponse } | DriftMatrixResponse
  return 'data' in json && json.data ? json.data : (json as DriftMatrixResponse)
}

export async function fetchEventsServer(
  projectId: string,
  params: { resolved?: boolean; limit?: number } = {},
): Promise<DriftEventsResponse | null> {
  const { baseUrl, cookie } = await serverBaseUrl()
  const search = new URLSearchParams()
  if (params.resolved !== undefined) search.set('resolved', String(params.resolved))
  if (params.limit !== undefined) search.set('limit', String(params.limit))
  const qs = search.toString()
  const res = await fetch(`${baseUrl}/api/drift/events/${projectId}${qs ? `?${qs}` : ''}`, {
    headers: { cookie },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const json = (await res.json()) as { data?: DriftEventsResponse } | DriftEventsResponse
  return 'data' in json && json.data ? json.data : (json as DriftEventsResponse)
}
