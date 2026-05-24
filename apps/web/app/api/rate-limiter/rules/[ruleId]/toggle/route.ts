import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { proxyToRateLimiter } from '@/lib/api-proxy'

export async function PUT(
  _request: Request,
  { params }: { params: { ruleId: string } },
): Promise<NextResponse> {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return proxyToRateLimiter(`/v1/rules/${params.ruleId}/toggle`, { method: 'PUT' })
}
