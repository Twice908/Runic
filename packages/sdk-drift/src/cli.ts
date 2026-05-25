#!/usr/bin/env node
import { Command } from 'commander'
import { config as loadDotenv } from 'dotenv'
import { readFileSync } from 'node:fs'
import { driftSnapshot } from './snapshot'

const DEFAULT_API_URL = 'https://drift.pulseobserve.com'

interface SnapshotOpts {
  env: string
  projectKey?: string
  dotenv?: string
  apiUrl?: string
  json?: boolean
}

function readDotenvKeys(path: string): Record<string, string | undefined> {
  // Parse the .env file but discard values immediately — we only ever forward key names.
  const raw = readFileSync(path, 'utf8')
  const parsed = loadDotenv({ path, processEnv: {} as NodeJS.ProcessEnv }).parsed
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

program.parseAsync(process.argv).catch(() => {
  // Final safety net — agent must never throw to the host process.
  process.exit(0)
})
