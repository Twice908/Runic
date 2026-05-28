import { Worker, type Job } from 'bullmq'
import { DriftEventType } from '@prisma/client'
import { prisma } from '../plugins/prisma'
import { redis } from '../plugins/redis'
import { redisUrl } from '../env'
import {
  DRIFT_DIFF_QUEUE,
  driftDiffQueue,
  type DriftDiffJobData,
} from '../lib/queue'
import { dispatch } from '../lib/notifications'

const parsed = new URL(redisUrl)
const connection = {
  host: parsed.hostname,
  port: parseInt(parsed.port || '6379', 10),
  password: parsed.password || undefined,
}

const MILLIS_PER_DAY = 86_400_000
const ALERT_DEBOUNCE_TTL_SECS = 300

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

interface NewDriftEvent {
  keyName: string
  driftType: DriftEventType
  rotationDays?: number
  daysSinceRotation?: number
}

function matchingAlertTypes(driftType: DriftEventType): string[] {
  if (driftType === DriftEventType.MISSING_KEY) {
    return ['key_missing_in_env', 'drift_detected']
  }
  if (driftType === DriftEventType.EXTRA_KEY) {
    return ['drift_detected']
  }
  if (driftType === DriftEventType.STALE_ROTATION) {
    return ['rotation_overdue', 'drift_detected']
  }
  return []
}

function buildAlertContent(
  alertType: string,
  event: NewDriftEvent,
  envName: string,
  allNewEvents: NewDriftEvent[],
): { subject: string; message: string } {
  if (alertType === 'key_missing_in_env') {
    return {
      subject: `[Pulse Drift] ${event.keyName} missing in ${envName}`,
      message: `${event.keyName} is present in production (baseline) but missing in ${envName}. Check your ${envName} configuration.`,
    }
  }
  if (alertType === 'rotation_overdue') {
    const days = Math.floor(event.daysSinceRotation ?? 0)
    const schedule = event.rotationDays ?? 0
    return {
      subject: `[Pulse Drift] ${event.keyName} rotation overdue`,
      message: `${event.keyName} has not been rotated in ${days} days. Rotation schedule: every ${schedule} days.`,
    }
  }
  // drift_detected — aggregate across all newly created events
  const missing = allNewEvents
    .filter((e) => e.driftType === DriftEventType.MISSING_KEY)
    .map((e) => e.keyName)
  const extra = allNewEvents
    .filter((e) => e.driftType === DriftEventType.EXTRA_KEY)
    .map((e) => e.keyName)
  const parts: string[] = []
  if (missing.length > 0) parts.push(`Missing: ${missing.join(', ')}.`)
  if (extra.length > 0) parts.push(`Extra: ${extra.join(', ')}.`)
  const tail = parts.length > 0 ? ' ' + parts.join(' ') : ''
  return {
    subject: `[Pulse Drift] Drift detected in ${envName}`,
    message: `${allNewEvents.length} key(s) drifted in ${envName} vs production baseline.${tail}`,
  }
}

async function dispatchDriftAlerts(
  projectId: string,
  environmentId: string,
  newEvents: NewDriftEvent[],
): Promise<void> {
  if (newEvents.length === 0) return

  const [project, env, alerts] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    }),
    prisma.driftEnvironment.findUnique({
      where: { id: environmentId },
      select: { name: true },
    }),
    prisma.alert.findMany({
      where: {
        projectId,
        active: true,
        type: { in: ['drift_detected', 'key_missing_in_env', 'rotation_overdue'] },
      },
    }),
  ])

  if (alerts.length === 0) return

  const projectName = project?.name ?? 'unknown'
  const envName = env?.name ?? 'unknown'

  for (const event of newEvents) {
    const matchingTypes = matchingAlertTypes(event.driftType)
    if (matchingTypes.length === 0) continue

    for (const alert of alerts) {
      if (!matchingTypes.includes(alert.type)) continue

      const debounceKey = `alert:debounce:${alert.id}:drift`
      const exists = await redis.exists(debounceKey)
      if (exists) continue

      const { subject, message } = buildAlertContent(alert.type, event, envName, newEvents)

      try {
        await dispatch({
          alertId: alert.id,
          projectId,
          projectName,
          channel: alert.channel as 'email' | 'slack',
          destination: alert.destination,
          subject,
          message,
        })

        await redis.set(debounceKey, '1', 'EX', ALERT_DEBOUNCE_TTL_SECS)

        await prisma.alertEvent.create({
          data: {
            alertId: alert.id,
            projectId,
            type: alert.type,
            triggeredValue: newEvents.length,
            threshold: 0,
            message,
            channel: alert.channel,
            destination: alert.destination,
          },
        })
      } catch {
        // alert dispatch failures must never crash the diff worker
      }
    }
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
  const openStaleIdByKey = new Map<string, string>()
  for (const e of openEvents) {
    if (!openByType[e.driftType]) openByType[e.driftType] = new Set()
    openByType[e.driftType].add(e.keyName)
    if (e.driftType === DriftEventType.STALE_ROTATION) {
      openStaleIdByKey.set(e.keyName, e.id)
    }
  }

  const missingSet = new Set(missingKeys)
  const extraSet = new Set(extraKeys)
  const now = new Date()
  const newlyCreatedEvents: NewDriftEvent[] = []

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
      newlyCreatedEvents.push({ keyName, driftType: DriftEventType.MISSING_KEY })
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
      newlyCreatedEvents.push({ keyName, driftType: DriftEventType.EXTRA_KEY })
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

  // ── PART 2: stale rotation detection ──────────────────────────────────────
  // For keys present in BOTH env and baseline, check rotation policy from
  // DriftKeyMeta (env-specific overrides global / environmentId=null).
  const commonKeys = [...envKeys].filter((k) => baselineKeys.has(k))
  const stalePerKey = new Set<string>()

  if (commonKeys.length > 0) {
    const metas = await prisma.driftKeyMeta.findMany({
      where: {
        projectId,
        keyName: { in: commonKeys },
        OR: [{ environmentId: null }, { environmentId }],
      },
    })
    const metaByKey = new Map<string, (typeof metas)[number]>()
    for (const m of metas) {
      const existing = metaByKey.get(m.keyName)
      if (!existing || (existing.environmentId === null && m.environmentId !== null)) {
        metaByKey.set(m.keyName, m)
      }
    }

    for (const keyName of commonKeys) {
      const meta = metaByKey.get(keyName)
      if (!meta || meta.rotationDays === null || meta.lastChangedAt === null) continue

      const daysSince = (Date.now() - meta.lastChangedAt.getTime()) / MILLIS_PER_DAY
      if (daysSince > meta.rotationDays) {
        stalePerKey.add(keyName)
        if (!openStaleIdByKey.has(keyName)) {
          await prisma.driftEvent.create({
            data: {
              projectId,
              environmentId,
              keyName,
              driftType: DriftEventType.STALE_ROTATION,
            },
          })
          newlyCreatedEvents.push({
            keyName,
            driftType: DriftEventType.STALE_ROTATION,
            rotationDays: meta.rotationDays,
            daysSinceRotation: daysSince,
          })
        }
      } else {
        const openId = openStaleIdByKey.get(keyName)
        if (openId) {
          await prisma.driftEvent.update({
            where: { id: openId },
            data: { resolved: true, resolvedAt: now },
          })
        }
      }
    }
  }

  const score = clamp(
    100 - missingKeys.length * 10 - extraKeys.length * 5 - stalePerKey.size * 15,
    0,
    100,
  )
  await prisma.driftEnvironment.update({
    where: { id: environmentId },
    data: { driftScore: score, lastSeenAt: now },
  })

  await invalidateMatrixCache(projectId)

  // ── PART 3: fire alerts for newly created drift events ────────────────────
  await dispatchDriftAlerts(projectId, environmentId, newlyCreatedEvents)
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
