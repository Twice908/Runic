import { Worker, type Job } from 'bullmq'
import { DriftEventType } from '@pulse/db'
import { prisma } from '../plugins/prisma'
import { redis } from '../plugins/redis'
import { redisUrl } from '../env'
import {
  DRIFT_DIFF_QUEUE,
  driftDiffQueue,
  type DriftDiffJobData,
} from '../lib/queue'

const parsed = new URL(redisUrl)
const connection = {
  host: parsed.hostname,
  port: parseInt(parsed.port || '6379', 10),
  password: parsed.password || undefined,
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

async function invalidateMatrixCache(projectId: string): Promise<void> {
  try {
    await redis.del(`matrix:${projectId}`)
  } catch {
    // cache eviction failures must never crash the worker
  }
}

export async function processDriftDiff(job: Job<DriftDiffJobData>): Promise<void> {
  const { manifestId, projectId, environmentId } = job.data

  const manifest = await prisma.driftManifest.findUnique({
    where: { id: manifestId },
    select: { keys: true },
  })
  if (!manifest) return

  const baseline = await prisma.driftEnvironment.findFirst({
    where: { projectId, isBaseline: true },
    select: { id: true },
  })

  // No baseline anywhere yet — promote submitting env, skip diff
  if (!baseline) {
    await prisma.driftEnvironment.update({
      where: { id: environmentId },
      data: { isBaseline: true, driftScore: 100, lastSeenAt: new Date() },
    })
    await invalidateMatrixCache(projectId)
    return
  }

  // Submitting env IS the baseline — re-enqueue diff for every other env
  if (baseline.id === environmentId) {
    const others = await prisma.driftEnvironment.findMany({
      where: { projectId, NOT: { id: environmentId } },
      select: { id: true },
    })
    for (const other of others) {
      const latest = await prisma.driftManifest.findFirst({
        where: { environmentId: other.id },
        orderBy: { capturedAt: 'desc' },
        select: { id: true },
      })
      if (latest) {
        await driftDiffQueue.add('diff', {
          manifestId: latest.id,
          projectId,
          environmentId: other.id,
        })
      }
    }
    await prisma.driftEnvironment.update({
      where: { id: environmentId },
      data: { driftScore: 100, lastSeenAt: new Date() },
    })
    await invalidateMatrixCache(projectId)
    return
  }

  const baselineManifest = await prisma.driftManifest.findFirst({
    where: { environmentId: baseline.id },
    orderBy: { capturedAt: 'desc' },
    select: { keys: true },
  })
  if (!baselineManifest) return

  const envKeys = new Set(manifest.keys)
  const baselineKeys = new Set(baselineManifest.keys)

  const missingKeys = [...baselineKeys].filter((k) => !envKeys.has(k))
  const extraKeys = [...envKeys].filter((k) => !baselineKeys.has(k))

  const openEvents = await prisma.driftEvent.findMany({
    where: { environmentId, resolved: false },
    select: { id: true, keyName: true, driftType: true },
  })
  const openByType: Record<string, Set<string>> = {}
  for (const e of openEvents) {
    if (!openByType[e.driftType]) openByType[e.driftType] = new Set()
    openByType[e.driftType].add(e.keyName)
  }

  const missingSet = new Set(missingKeys)
  const extraSet = new Set(extraKeys)
  const now = new Date()

  for (const keyName of missingKeys) {
    if (!openByType[DriftEventType.MISSING_KEY]?.has(keyName)) {
      await prisma.driftEvent.create({
        data: {
          projectId,
          environmentId,
          keyName,
          driftType: DriftEventType.MISSING_KEY,
        },
      })
    }
  }

  for (const keyName of extraKeys) {
    if (!openByType[DriftEventType.EXTRA_KEY]?.has(keyName)) {
      await prisma.driftEvent.create({
        data: {
          projectId,
          environmentId,
          keyName,
          driftType: DriftEventType.EXTRA_KEY,
        },
      })
    }
  }

  for (const e of openEvents) {
    let stillDrifting = false
    if (e.driftType === DriftEventType.MISSING_KEY) stillDrifting = missingSet.has(e.keyName)
    else if (e.driftType === DriftEventType.EXTRA_KEY) stillDrifting = extraSet.has(e.keyName)
    else continue

    if (!stillDrifting) {
      await prisma.driftEvent.update({
        where: { id: e.id },
        data: { resolved: true, resolvedAt: now },
      })
      await prisma.driftEvent.create({
        data: {
          projectId,
          environmentId,
          keyName: e.keyName,
          driftType: DriftEventType.KEY_RESTORED,
          resolved: true,
          resolvedAt: now,
        },
      })
    }
  }

  const score = clamp(100 - missingKeys.length * 10 - extraKeys.length * 5, 0, 100)
  await prisma.driftEnvironment.update({
    where: { id: environmentId },
    data: { driftScore: score, lastSeenAt: now },
  })

  await invalidateMatrixCache(projectId)
}

export const driftDiffWorker = new Worker<DriftDiffJobData>(
  DRIFT_DIFF_QUEUE,
  processDriftDiff,
  { connection, concurrency: 5 },
)

driftDiffWorker.on('failed', (job, err) => {
  // swallow — a failed diff job must never crash the worker process
  // eslint-disable-next-line no-console
  console.error('[drift-diff-worker] job failed', {
    jobId: job?.id,
    err: err.message,
  })
})
