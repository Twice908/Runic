import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { proxyToApi } from '@/lib/api-proxy'

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { userId, getToken } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = await getToken()
  if (!token) return NextResponse.json({ error: 'No session token' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const response = await proxyToApi(
    `/projects/${params.id}/analytics/latency?${searchParams.toString()}`,
    token,
  )
  console.log(`[analytics/latency] proxy status: ${response.status}`)
  return response
}
