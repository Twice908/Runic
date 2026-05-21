import type { Redis } from 'ioredis'

export interface CounterResult {
  count: number
  remaining: number
  allowed: boolean
  resetAt: number // Unix timestamp (seconds) when the current window slot ends
}

export function buildCounterKey(
  projectId: string,
  ruleId: string,
  keyValue: string,
  windowSlot: number,
): string {
  return `rl:${projectId}:${ruleId}:${keyValue}:${windowSlot}`
}

/**
 * Atomically increments the fixed-window counter for the given rule + key.
 *
 * Atomicity: INCR is atomic in Redis. EXPIREAT runs as the next pipeline
 * command and sets the expiry to the exact slot-end timestamp. The window
 * slot is encoded in the key, so even in the unlikely event that EXPIREAT
 * does not execute (client crash mid-pipeline), the stale key is harmless —
 * it belongs to a past slot and will never be incremented again.
 *
 * No read-modify-write is performed at any point.
 */
export async function incrementCounter(
  redis: Redis,
  projectId: string,
  ruleId: string,
  keyValue: string,
  windowSecs: number,
  limitCount: number,
): Promise<CounterResult> {
  const nowSecs = Math.floor(Date.now() / 1000)
  const windowSlot = Math.floor(nowSecs / windowSecs)
  const resetAt = (windowSlot + 1) * windowSecs
  const key = buildCounterKey(projectId, ruleId, keyValue, windowSlot)

  const pipeline = redis.pipeline()
  pipeline.incr(key)
  pipeline.expireat(key, resetAt)
  const results = await pipeline.exec()

  const count = (results?.[0]?.[1] ?? 1) as number
  const remaining = Math.max(0, limitCount - count)

  return {
    count,
    remaining,
    allowed: count <= limitCount,
    resetAt,
  }
}
