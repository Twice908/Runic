'use client'

import { use, useState } from 'react'

type Snippet = {
  id: string
  label: string
  code: string
}

const PLACEHOLDER_KEY = 'YOUR_KEY'

function CodeBlock({ code, blockId, copiedId, onCopy }: {
  code: string
  blockId: string
  copiedId: string | null
  onCopy: (id: string, code: string) => void
}) {
  return (
    <div className="relative group">
      <pre className="rounded-lg bg-gray-900 text-gray-100 text-xs font-mono p-4 overflow-x-auto whitespace-pre">
        <code>{code}</code>
      </pre>
      <button
        onClick={() => onCopy(blockId, code)}
        className="absolute top-2 right-2 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-[11px] font-medium text-gray-200 opacity-0 group-hover:opacity-100 hover:bg-gray-700 transition-opacity"
      >
        {copiedId === blockId ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function TabbedSnippets({
  snippets,
  copiedId,
  onCopy,
  groupId,
}: {
  snippets: Snippet[]
  copiedId: string | null
  onCopy: (id: string, code: string) => void
  groupId: string
}) {
  const [active, setActive] = useState(snippets[0]?.id ?? '')
  const current = snippets.find((s) => s.id === active) ?? snippets[0]

  return (
    <div className="space-y-3">
      <div className="flex gap-1 border-b border-gray-200">
        {snippets.map((s) => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
              active === s.id
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {current && (
        <CodeBlock
          code={current.code}
          blockId={`${groupId}-${current.id}`}
          copiedId={copiedId}
          onCopy={onCopy}
        />
      )}
    </div>
  )
}

export default function DriftSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = use(params)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const projectKeyDisplay = PLACEHOLDER_KEY

  async function handleCopy(id: string, code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedId(id)
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500)
    } catch {
      setCopiedId(null)
    }
  }

  const installCmd = `npm install -g @pulse/drift-agent`

  const snapshotGhAction = `- name: Pulse Drift Snapshot
  env:
    PULSE_API_KEY: \${{ secrets.PULSE_API_KEY }}
  run: |
    npx @pulse/drift-agent snapshot \\
      --env \${{ github.ref == 'refs/heads/main' && 'production' || 'staging' }} \\
      --project-key $PULSE_API_KEY`

  const snapshotCli = `pulse-drift snapshot --env production --project-key ${projectKeyDisplay}`

  const ciCheckGhAction = `- name: Pulse Drift Check
  env:
    PULSE_API_KEY: \${{ secrets.PULSE_API_KEY }}
  run: |
    npx @pulse/drift-agent ci-check \\
      --env staging \\
      --project-key $PULSE_API_KEY \\
      --fail-on-drift \\
      --ignore-keys DATABASE_URL,NODE_ENV`

  const ciCheckCli = `pulse-drift ci-check --env staging \\
  --project-key ${projectKeyDisplay} \\
  --fail-on-drift \\
  --ignore-keys DATABASE_URL,NODE_ENV`

  const programmatic = `import { driftSnapshot } from '@pulse/drift-agent'

driftSnapshot({
  projectKey: process.env.PULSE_API_KEY,
  environment: process.env.NODE_ENV,
})`

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-10">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Drift Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Agent setup and CI snippets for project{' '}
          <span className="font-mono text-gray-700">{projectId}</span>
        </p>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">1. Quick Start</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Install the Pulse drift agent globally.
          </p>
        </div>
        <CodeBlock
          code={installCmd}
          blockId="install"
          copiedId={copiedId}
          onCopy={handleCopy}
        />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">2. CI Snapshot Setup</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Capture environment manifests on every CI run.
          </p>
        </div>
        <TabbedSnippets
          groupId="snapshot"
          copiedId={copiedId}
          onCopy={handleCopy}
          snippets={[
            { id: 'gh', label: 'GitHub Actions', code: snapshotGhAction },
            { id: 'cli', label: 'Manual CLI', code: snapshotCli },
          ]}
        />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">3. CI Drift Check</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Block deploys when drift is detected against your baseline.
          </p>
        </div>
        <TabbedSnippets
          groupId="cicheck"
          copiedId={copiedId}
          onCopy={handleCopy}
          snippets={[
            { id: 'gh', label: 'GitHub Actions', code: ciCheckGhAction },
            { id: 'cli', label: 'CLI', code: ciCheckCli },
          ]}
        />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">4. Programmatic Usage</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Call the agent directly from your Node.js application.
          </p>
        </div>
        <CodeBlock
          code={programmatic}
          blockId="programmatic"
          copiedId={copiedId}
          onCopy={handleCopy}
        />
      </section>
    </div>
  )
}
