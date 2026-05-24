import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import IORedisMock from 'ioredis-mock'
import { incrementCounter, buildCounterKey } from './counter'
import type { Redis } from 'ioredis'

// ioredis-mock is a drop-in replacement — cast is safe in tests
function makeMockRedis(): Redis {
  return new IORedisMock() as unknown as Redis
}

describe('buildCounterKey', () => {
  it('follows rl:{projectId}:{ruleId}:{keyValue}:{windowSlot} schema', () => {
    expect(buildCounterKey('proj1', 'rule1', '1.2.3.4', 42)).toBe('rl:proj1:rule1:1.2.3.4:42')
  })

  it('different projectIds produce different keys (key isolation invariant)', () => {
    const keyA = buildCounterKey('projA', 'rule1', '1.2.3.4', 42)
    const keyB = buildCounterKey('projB', 'rule1', '1.2.3.4', 42)
    expect(keyA).not.toBe(keyB)
    expect(keyA.startsWith('rl:projA:')).toBe(true)
    expect(keyB.startsWith('rl:projB:')).toBe(true)
  })

  it('different ruleIds produce different keys', () => {
    const k1 = buildCounterKey('proj1', 'ruleX', 'ip', 42)
    const k2 = buildCounterKey('proj1', 'ruleY', 'ip', 42)
    expect(k1).not.toBe(k2)
  })

  it('different windowSlots produce different keys', () => {
    const k1 = buildCounterKey('proj1', 'rule1', 'ip', 0)
    const k2 = buildCounterKey('proj1', 'rule1', 'ip', 1)
    expect(k1).not.toBe(k2)
  })
})

describe('incrementCounter', () => {
  let redis: Redis

  // Fix time to 2024-01-01 00:00:00 UTC
  // Date.now() = 1704067200000
  // windowSlot(60s) = floor(1704067200000 / 1000 / 60) = 28401120
  // resetAt(60s)    = 28401121 * 60 = 1704067260

  beforeEach(() => {
    redis = makeMockRedis()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
  })

  afterEach(async () => {
    await (redis as unknown as IORedisMock).flushall()
    vi.useRealTimers()
  })

  it('first increment: count=1, allowed=true, remaining=limit-1', async () => {
    const r = await incrementCounter(redis, 'proj1', 'rule1', '10.0.0.1', 60, 100)
    expect(r.count).toBe(1)
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(99)
  })

  it('cumulative counts within same window slot', async () => {
    for (let i = 0; i < 5; i++) {
      await incrementCounter(redis, 'proj1', 'rule1', '10.0.0.1', 60, 100)
    }
    const r = await incrementCounter(redis, 'proj1', 'rule1', '10.0.0.1', 60, 100)
    expect(r.count).toBe(6)
    expect(r.remaining).toBe(94)
    expect(r.allowed).toBe(true)
  })

  it('allowed=true when count equals limitCount (at the boundary)', async () => {
    for (let i = 0; i < 9; i++) {
      await incrementCounter(redis, 'proj1', 'rule1', 'ip1', 60, 10)
    }
    const r = await incrementCounter(redis, 'proj1', 'rule1', 'ip1', 60, 10)
    expect(r.count).toBe(10)
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(0)
  })

  it('allowed=false and remaining=0 when count exceeds limitCount', async () => {
    for (let i = 0; i < 10; i++) {
      await incrementCounter(redis, 'proj1', 'rule1', 'ip1', 60, 10)
    }
    const r = await incrementCounter(redis, 'proj1', 'rule1', 'ip1', 60, 10)
    expect(r.count).toBe(11)
    expect(r.allowed).toBe(false)
    expect(r.remaining).toBe(0)
  })

  it('WINDOW BOUNDARY: advancing time to new slot resets count to 1', async () => {
    // Fill window slot 0
    for (let i = 0; i < 5; i++) {
      await incrementCounter(redis, 'proj1', 'rule1', 'ip1', 60, 100)
    }
    // Advance to next window slot (61s later)
    vi.advanceTimersByTime(61_000)

    const r = await incrementCounter(redis, 'proj1', 'rule1', 'ip1', 60, 100)
    expect(r.count).toBe(1)
    expect(r.allowed).toBe(true)
  })

  it('WINDOW BOUNDARY: request at exact slot boundary uses the new slot', async () => {
    // At t=0 (slot 0 for windowSecs=60): slot = floor(1704067200/60) = 28401120
    const r1 = await incrementCounter(redis, 'proj1', 'rule1', 'ip1', 60, 100)
    expect(r1.count).toBe(1)

    // At t=60000ms exactly: floor((1704067200+60)/60) = floor(28401121) = 28401121 → new slot
    vi.advanceTimersByTime(60_000)
    const r2 = await incrementCounter(redis, 'proj1', 'rule1', 'ip1', 60, 100)
    expect(r2.count).toBe(1) // new slot, not continuation of old slot
  })

  it('KEY ISOLATION: projectId A cannot affect counters for projectId B', async () => {
    // Exhaust project B
    for (let i = 0; i < 10; i++) {
      await incrementCounter(redis, 'projB', 'rule1', 'ip1', 60, 10)
    }
    // Project A should be untouched
    const r = await incrementCounter(redis, 'projA', 'rule1', 'ip1', 60, 10)
    expect(r.count).toBe(1)
    expect(r.allowed).toBe(true)
  })

  it('KEY ISOLATION: different ruleIds are independent', async () => {
    for (let i = 0; i < 10; i++) {
      await incrementCounter(redis, 'proj1', 'ruleX', 'ip1', 60, 10)
    }
    const r = await incrementCounter(redis, 'proj1', 'ruleY', 'ip1', 60, 10)
    expect(r.count).toBe(1)
    expect(r.allowed).toBe(true)
  })

  it('KEY ISOLATION: different keyValues are independent', async () => {
    for (let i = 0; i < 10; i++) {
      await incrementCounter(redis, 'proj1', 'rule1', '10.0.0.1', 60, 10)
    }
    const r = await incrementCounter(redis, 'proj1', 'rule1', '10.0.0.2', 60, 10)
    expect(r.count).toBe(1)
    expect(r.allowed).toBe(true)
  })

  it('provides resetAt equal to the end of the current window slot (Unix seconds)', async () => {
    // windowSlot = floor(1704067200 / 60) = 28401120
    // resetAt    = 28401121 * 60 = 1704067260
    const r = await incrementCounter(redis, 'proj1', 'rule1', 'ip1', 60, 100)
    expect(r.resetAt).toBe(1704067260)
  })
})
