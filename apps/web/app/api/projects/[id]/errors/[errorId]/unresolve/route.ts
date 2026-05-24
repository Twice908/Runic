import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { proxyToApi } from '@/lib/api-proxy'

export async function PATCH(
  _request: Request,
  { params }: { params: { id: string; errorId: string } },
): Promise<NextResponse> {
  const { userId, getToken } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = await getToken()
  if (!token) return NextResponse.json({ error: 'No session token' }, { status: 401 })

  return proxyToApi(`/projects/${params.id}/errors/${params.errorId}/unresolve`, token, { method: 'PATCH' })
}
