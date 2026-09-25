import * as core from '@actions/core'

const DEFAULT_API_URL = 'https://drift.runicobserve.com'
const TIMEOUT_MS = 10_000

interface CiCheckResult {
  passed: boolean
  missingKeys: string[]
  extraKeys: string[]
  driftScore: number
  baseline: string | null
}

async function run(): Promise<void> {
  try {
    const projectKey = core.getInput('project-key', { required: true })
    const projectId = core.getInput('project-id', { required: true })
    const environment = core.getInput('environment', { required: true })
    const failOnDrift = core.getInput('fail-on-drift') === 'true'
    const ignoreKeys = core.getInput('ignore-keys')
    const apiUrl = core.getInput('api-url') || DEFAULT_API_URL

    // Mirrors exactly what `runic-drift ci-check --json` does internally.
    // Bundled via ncc — no subprocess or installed binary required.
    const qs = new URLSearchParams({ environment })
    if (ignoreKeys) qs.set('ignoreKeys', ignoreKeys)
    const url = `${apiUrl}/ci-check/${projectId}?${qs.toString()}`

    core.debug(`GET ${url}`)

    const res = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${projectKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!res.ok) {
      // Fail-open: log a warning but don't break the build on infrastructure issues.
      core.warning(`Drift check returned HTTP ${res.status} — skipping`)
      core.setOutput('drift-score', '')
      core.setOutput('missing-keys', '')
      core.setOutput('extra-keys', '')
      return
    }

    const result = (await res.json()) as CiCheckResult

    const baselineLabel = result.baseline ?? 'no baseline set'
    const missingLabel = result.missingKeys.length === 0 ? 'none' : result.missingKeys.join(', ')
    const extraLabel = result.extraKeys.length === 0 ? 'none' : result.extraKeys.join(', ')

    // Set all declared action outputs before any failure so downstream steps
    // can read them even when the job is marked failed.
    core.setOutput('drift-score', String(result.driftScore))
    core.setOutput('missing-keys', result.missingKeys.join(','))
    core.setOutput('extra-keys', result.extraKeys.join(','))

    core.info(`Drift Check — ${environment} vs ${baselineLabel}`)
    core.info('─────────────────────────────────')
    core.info(`Drift Score:   ${result.driftScore}/100`)
    core.info(`Missing keys:  ${missingLabel}`)
    core.info(`Extra keys:    ${extraLabel}`)
    core.info(`Result:        ${result.passed ? '✓ PASSED' : '✗ FAILED'}`)

    if (failOnDrift && !result.passed) {
      core.setFailed(
        `Drift detected in environment "${environment}" (score: ${result.driftScore}/100). ` +
        `Missing: [${missingLabel}] Extra: [${extraLabel}]`,
      )
    }
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err))
  }
}

run()
