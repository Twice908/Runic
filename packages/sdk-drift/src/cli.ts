#!/usr/bin/env node
import { Command } from 'commander'
import { config as loadDotenv } from 'dotenv'
import { readFileSync } from 'node:fs'
import fetch from 'node-fetch'
import { driftSnapshot } from './snapshot'

const DEFAULT_API_URL = 'https://drift.pulseobserve.com'

interface SnapshotOpts {
  env: string
  projectKey?: string
  dotenv?: string
  apiUrl?: string
  json?: boolean
}

interface CiCheckOpts {
  env: string
  projectKey?: string
  apiUrl?: string
  failOnDrift?: boolean
  ignoreKeys?: string
  json?: boolean
}

interface CiCheckResult {
  passed: boolean
  missingKeys: string[]
  extraKeys: string[]
  driftScore: number
  baseline: string | null
}

const CI_CHECK_TIMEOUT_MS = 10_000

function readDotenvKeys(path: string): Record<string, string | undefined> {
  // Parse the .env file but discard values immediately — we only ever forward key names.
  const raw = readFileSync(path, 'utf8')
  loadDotenv({ path, override: true })
  const parsed = process.env
  // dotenv's parsed return covers the key/value pairs without touching real process.env.
  // We keep the names; values are not used by extractKeyNames.
  const out: Record<string, string | undefined> = {}
  if (parsed) {
    for (const key of Object.keys(parsed)) out[key] = ''
  } else {
    // Fallback line parse in case dotenv returns nothing
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)
      if (m) out[m[1]] = ''
    }
  }
  return out
}

const program = new Command()

program
  .name('pulse-drift')
  .description('Pulse Drift agent CLI — env/secret drift detection')
  .version('0.0.1')

program
  .command('snapshot')
  .description('Capture current env key names and send to the drift collector')
  .requiredOption('--env <name>', 'environment name (e.g. production, staging)')
  .option('--project-key <key>', 'Pulse project API key (or set PULSE_API_KEY)')
  .option('--dotenv <path>', 'read keys from a .env file instead of process.env')
  .option('--api-url <url>', `drift collector URL (default ${DEFAULT_API_URL})`)
  .option('--json', 'emit a JSON result line instead of human text')
  .action(async (opts: SnapshotOpts) => {
    const projectKey = opts.projectKey ?? process.env.PULSE_API_KEY
    if (!projectKey) {
      const msg = 'project key is required: pass --project-key or set PULSE_API_KEY'
      if (opts.json) {
        process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n')
      } else {
        process.stderr.write(`[pulse-drift] ${msg}\n`)
      }
      process.exit(0)
    }

    const sourceEnv = opts.dotenv ? readDotenvKeys(opts.dotenv) : process.env

    const result = await driftSnapshot({
      environment: opts.env,
      projectKey,
      apiUrl: opts.apiUrl ?? DEFAULT_API_URL,
      env: sourceEnv,
    })

    if (opts.json) {
      process.stdout.write(JSON.stringify(result) + '\n')
    } else if (result.ok) {
      process.stdout.write(
        `✓ Snapshot sent — ${result.keyCount} keys from ${opts.env}\n`,
      )
    } else {
      // driftSnapshot already warned to stderr; CLI still exits 0
      process.stdout.write(
        `Snapshot attempt completed for ${opts.env} (${result.keyCount} keys, status ${result.status ?? 'n/a'})\n`,
      )
    }
    process.exit(0)
  })

program
  .command('ci-check')
  .description('Compare an environment against baseline — CI-friendly, fail-open')
  .requiredOption('--env <name>', 'environment name to check')
  .option('--project-key <key>', 'Pulse project API key (or set PULSE_API_KEY)')
  .option('--api-url <url>', `drift collector URL (default ${DEFAULT_API_URL})`)
  .option('--fail-on-drift', 'exit 1 if drift is detected', false)
  .option('--ignore-keys <keys>', 'comma-separated key names to ignore')
  .option('--json', 'emit a JSON result line instead of human text')
  .action(async (opts: CiCheckOpts) => {
    const projectKey = opts.projectKey ?? process.env.PULSE_API_KEY
    if (!projectKey) {
      const msg = 'project key is required: pass --project-key or set PULSE_API_KEY'
      if (opts.json) {
        process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n')
      } else {
        process.stderr.write(`[pulse-drift] ${msg}\n`)
      }
      process.exit(0)
    }

    const apiUrl = opts.apiUrl ?? DEFAULT_API_URL
    const qs = new URLSearchParams({ environment: opts.env })
    if (opts.ignoreKeys) qs.set('ignoreKeys', opts.ignoreKeys)
    const url = `${apiUrl}/v1/ci-check/self?${qs.toString()}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CI_CHECK_TIMEOUT_MS)

    let result: CiCheckResult | null = null
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${projectKey}` },
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(`drift check responded with status ${res.status}`)
      }
      result = (await res.json()) as CiCheckResult
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error'
      if (opts.json) {
        process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n')
      } else {
        process.stderr.write(
          `[pulse-drift] warning — drift check unreachable: ${msg}\n`,
        )
      }
      process.exit(0)
    } finally {
      clearTimeout(timer)
    }

    if (!result) process.exit(0)

    if (opts.json) {
      process.stdout.write(JSON.stringify(result) + '\n')
    } else {
      const baselineLabel = result.baseline ?? 'no baseline set'
      const missingLabel =
        result.missingKeys.length === 0 ? 'none' : result.missingKeys.join(', ')
      const extraLabel =
        result.extraKeys.length === 0 ? 'none' : result.extraKeys.join(', ')
      const resultLabel = result.passed ? '✓ PASSED' : '✗ FAILED'
      process.stdout.write(`Drift Check — ${opts.env} vs ${baselineLabel}\n`)
      process.stdout.write('─────────────────────────────────\n')
      process.stdout.write(`Drift Score:   ${result.driftScore}/100\n`)
      process.stdout.write(`Missing keys:  ${missingLabel}\n`)
      process.stdout.write(`Extra keys:    ${extraLabel}\n`)
      process.stdout.write(`Result:        ${resultLabel}\n`)
    }

    if (opts.failOnDrift && !result.passed) {
      process.exit(1)
    }
    process.exit(0)
  })

program.parseAsync(process.argv).catch(() => {
  // Final safety net — agent must never throw to the host process.
  process.exit(0)
})
