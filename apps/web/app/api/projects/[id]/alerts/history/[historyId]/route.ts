import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { proxyToApi } from '@/lib/api-proxy'

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; historyId: string } },
): Promise<NextResponse> {
  const { userId, getToken } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = await getToken()
  if (!token) return NextResponse.json({ error: 'No session token' }, { status: 401 })

  return proxyToApi(`/projects/${params.id}/alerts/history/${params.historyId}`, token, { method: 'DELETE' })
}
