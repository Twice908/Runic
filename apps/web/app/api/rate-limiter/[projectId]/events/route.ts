import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { proxyToRateLimiter } from '@/lib/api-proxy'

export async function GET(
  request: Request,
  { params }: { params: { projectId: string } },
): Promise<NextResponse> {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const qs = searchParams.toString()
  const path = qs
    ? `/v1/analytics/${params.projectId}/events?${qs}`
    : `/v1/analytics/${params.projectId}/events`

  return proxyToRateLimiter(path)
}
