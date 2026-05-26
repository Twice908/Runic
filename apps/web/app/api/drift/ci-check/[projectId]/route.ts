import type { NextRequest } from 'next/server'
import { proxyToDrift } from '@/lib/api-proxy'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const search = req.nextUrl.search ?? ''
  return proxyToDrift(req, `/v1/ci-check/${projectId}${search}`)
}
