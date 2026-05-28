import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { proxyToDrift } from '@/lib/api-proxy'

export async function GET(
  request: Request,
  { params }: { params: { projectId: string } },
): Promise<NextResponse> {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cookie = request.headers.get('cookie') ?? undefined
  return proxyToDrift(`/v1/keys/${params.projectId}`, { cookie })
}
