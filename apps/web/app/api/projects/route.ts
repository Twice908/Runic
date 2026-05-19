import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@pulse/db'
import { proxyToApi } from '@/lib/api-proxy'
import type { ProjectSummary, ApiResponse, CreateProjectResponse } from '@pulse/types'

export async function GET(): Promise<NextResponse> {
  const { userId } = auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    include: {
      projects: {
        select: { id: true, name: true, apiKeyPrefix: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  const projects: ProjectSummary[] = (user?.projects ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    apiKeyPrefix: p.apiKeyPrefix,
    createdAt: p.createdAt.toISOString(),
  }))

  return NextResponse.json({ projects })
}

const createProjectSchema = z.object({
  name: z.string().min(1).max(100).trim(),
})

export async function POST(request: Request): Promise<NextResponse> {
  const { userId, getToken } = auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = createProjectSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  const token = await getToken()
  if (!token) {
    return NextResponse.json({ error: 'No session token' }, { status: 401 })
  }

  return proxyToApi('/projects', token, {
    method: 'POST',
    body: JSON.stringify({ name: parsed.data.name }),
  })
}
