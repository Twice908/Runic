import { proxyToDrift } from '@/lib/api-proxy'

export async function GET(
  req: Request,
  { params }: { params: { projectId: string } },
) {
  const { projectId } = params
  const search = new URL(req.url).search ?? ''
  const cookie = req.headers.get('cookie') ?? undefined
  return proxyToDrift(`/v1/ci-check/${projectId}${search}`, { cookie })
}
