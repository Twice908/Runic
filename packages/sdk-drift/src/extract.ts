import { ALWAYS_IGNORED, KEY_PATTERN } from './constants'

/**
 * Extracts and sanitizes env-var KEY NAMES from an env-like record.
 * Values are never inspected; only keys are returned.
 */
export function extractKeyNames(
  env: Record<string, string | undefined>,
  ignoreList: readonly string[] = [],
): string[] {
  const ignored = new Set<string>([
    ...ALWAYS_IGNORED.map((k) => k.toUpperCase()),
    ...ignoreList.map((k) => k.trim().toUpperCase()),
  ])

  const out = new Set<string>()
  for (const raw of Object.keys(env)) {
    const k = raw.trim().toUpperCase()
    if (!k) continue
    if (ignored.has(k)) continue
    if (!KEY_PATTERN.test(k)) continue
    out.add(k)
  }
  return [...out].sort()
}
