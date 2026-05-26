import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { proxyToDrift } from '@/lib/api-proxy'

export async function PATCH(
  request: Request,
  { params }: { params: { projectId: string; keyName: string } },
): Promise<NextResponse> {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cookie = request.headers.get('cookie') ?? undefined
  const body = await request.text()
  const keyName = encodeURIComponent(params.keyName)
  return proxyToDrift(`/v1/keys/${params.projectId}/${keyName}`, {
    method: 'PATCH',
    body,
    cookie,
  })
}
