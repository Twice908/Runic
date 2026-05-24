import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { proxyToRateLimiter } from '@/lib/api-proxy'

export async function PATCH(
  request: Request,
  { params }: { params: { ruleId: string } },
): Promise<NextResponse> {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.text()
  return proxyToRateLimiter(`/v1/rules/${params.ruleId}`, { method: 'PATCH', body })
}

export async function DELETE(
  _request: Request,
  { params }: { params: { ruleId: string } },
): Promise<NextResponse> {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return proxyToRateLimiter(`/v1/rules/${params.ruleId}`, { method: 'DELETE' })
}
