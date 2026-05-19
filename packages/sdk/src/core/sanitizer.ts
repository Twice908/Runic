const BLOCKED_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'proxy-authorization',
])

const REDACTED_FIELDS = new Set([
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'creditcard',
  'ssn',
  'cvv',
])

const MAX_BODY_LENGTH = 2048

export function sanitizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (BLOCKED_HEADERS.has(key.toLowerCase())) continue
    if (value === undefined) continue
    result[key] = Array.isArray(value) ? value.join(', ') : value
  }
  return result
}

export function sanitizeBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined

  try {
    const obj = typeof body === 'string' ? body : redactSensitiveFields(body)
    const str = typeof obj === 'string' ? obj : JSON.stringify(obj)
    if (str.length > MAX_BODY_LENGTH) {
      return str.slice(0, MAX_BODY_LENGTH) + '...[truncated]'
    }
    return str
  } catch {
    return undefined
  }
}

function redactSensitiveFields(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj
  if (Array.isArray(obj)) return obj.map(redactSensitiveFields)

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (REDACTED_FIELDS.has(key.toLowerCase().replace(/[-_]/g, ''))) {
      result[key] = '[redacted]'
    } else {
      result[key] = redactSensitiveFields(value)
    }
  }
  return result
}
