import { NextResponse } from 'next/server'

const API_UNREACHABLE = NextResponse.json(
  { error: 'API server unreachable. Is apps/api running on port 3001?' },
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
  return NextResponse.json(await res.json(), { status: res.status })
}
