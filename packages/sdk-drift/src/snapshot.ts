import { extractKeyNames } from './extract'
import fetch, { Response } from 'node-fetch'

export interface DriftSnapshotOptions {
  environment: string
  projectKey: string
  apiUrl?: string
  agentVersion?: string
  env?: Record<string, string | undefined>
  ignoreKeys?: readonly string[]
  timeoutMs?: number
  agentId?: string
}

export interface DriftSnapshotResult {
  ok: boolean
  keyCount: number
  status?: number
}

const DEFAULT_API_URL = 'https://drift.pulseobserve.com'
const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_AGENT_VERSION = '0.0.1'

/**
 * Sends an env-key manifest to the drift collector.
 * Hard contract: never throws, never rejects, never blocks the host process.
 * On any error, warns to stderr and resolves with { ok: false }.
 */
export async function driftSnapshot(
  options: DriftSnapshotOptions,
): Promise<DriftSnapshotResult> {
  try {
    const source = options.env ?? process.env
    const keys = extractKeyNames(source, options.ignoreKeys ?? [])

    const body = {
      environment: options.environment,
      keys,
      agentVersion: options.agentVersion ?? DEFAULT_AGENT_VERSION,
      capturedAt: new Date().toISOString(),
      ...(options.agentId !== undefined ? { agentId: options.agentId } : {}),
    }

    const apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, '')
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let res: Response
    try {
      res = await fetch(`${apiUrl}/v1/snapshot`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.projectKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[pulse-drift] snapshot failed: HTTP ${res.status}`,
      )
      return { ok: false, keyCount: keys.length, status: res.status }
    }

    return { ok: true, keyCount: keys.length, status: res.status }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.warn('[pulse-drift] snapshot failed:', message)
    return { ok: false, keyCount: 0 }
  }
}
