'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import RegenerateKeyModal from '@/components/RegenerateKeyModal'
import type { ProjectSummary } from '@pulse/types'

export default function SettingsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const projectId = searchParams.get('project') ?? ''

  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)

  // API key section
  const [showRegenerateModal, setShowRegenerateModal] = useState(false)

  // Rename section
  const [nameValue, setNameValue] = useState('')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState('')
  const [nameSaved, setNameSaved] = useState(false)

  // Delete section
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [showDeleteForm, setShowDeleteForm] = useState(false)

  useEffect(() => {
    apiFetch<{ projects: ProjectSummary[] }>('/api/projects')
      .then((d) => {
        setProjects(d.projects)
        const proj = d.projects.find((p) => p.id === projectId) ?? d.projects[0]
        if (proj) setNameValue(proj.name)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId])

  const project = projects.find((p) => p.id === projectId) ?? projects[0]

  async function handleRename(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = nameValue.trim()
    if (!trimmed) { setNameError('Name cannot be empty'); return }
    if (trimmed.length > 64) { setNameError('Name must be 64 characters or fewer'); return }
    setNameError('')
    setNameSaving(true)
    try {
      const res = await fetch(`/api/projects/${project?.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } | string }
        const msg = typeof json.error === 'object' ? json.error?.message : json.error
        setNameError(msg ?? `HTTP ${res.status}`)
        return
      }
      setNameSaved(true)
      setTimeout(() => setNameSaved(false), 3000)
      router.refresh()
    } catch {
      setNameError('Failed to rename project')
    } finally {
      setNameSaving(false)
    }
  }

  async function handleDelete() {
    if (!project || deleteConfirmText !== project.name) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } | string }
        const msg = typeof json.error === 'object' ? json.error?.message : json.error
        setDeleteError(msg ?? `HTTP ${res.status}`)
        return
      }
      router.push('/dashboard')
      router.refresh()
    } catch {
      setDeleteError('Failed to delete project')
    } finally {
      setDeleting(false)
    }
  }

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">Select a project from the sidebar.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-8 space-y-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-100" />
        ))}
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">Project not found.</p>
      </div>
    )
  }

  const maskedKey = `${project.apiKeyPrefix}••••••••••••`

  return (
    <div className="max-w-2xl mx-auto p-8 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">{project.name}</p>
      </div>

      {/* ── Project Name ─────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="text-base font-semibold text-gray-900">Project Name</h2>
        <form onSubmit={handleRename} className="flex items-end gap-3">
          <div className="flex-1">
            <input
              type="text"
              value={nameValue}
              onChange={(e) => { setNameValue(e.target.value); setNameError('') }}
              maxLength={64}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {nameError && <p className="mt-1 text-xs text-red-600">{nameError}</p>}
          </div>
          <button
            type="submit"
            disabled={nameSaving || nameValue.trim() === project.name}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {nameSaving ? 'Saving…' : nameSaved ? 'Saved' : 'Save'}
          </button>
        </form>
      </section>

      {/* ── API Key ──────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="text-base font-semibold text-gray-900">API Key</h2>
        <p className="text-sm text-gray-500">
          Use this key in the Pulse SDK to send data from your backend.
        </p>
        <div className="flex items-center gap-3">
          <code className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-700 select-none">
            {maskedKey}
          </code>
          <button
            onClick={() => setShowRegenerateModal(true)}
            className="flex-shrink-0 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 transition-colors"
          >
            Regenerate
          </button>
        </div>
        <p className="text-xs text-gray-400">
          The full key is never shown again after creation. Regenerating will invalidate the current key immediately.
        </p>
      </section>

      {/* ── Danger Zone ──────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-red-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="text-base font-semibold text-red-700">Danger Zone</h2>

        {!showDeleteForm ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800">Delete project</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Permanently deletes all logs, errors, alerts, and uptime data. This cannot be undone.
              </p>
            </div>
            <button
              onClick={() => setShowDeleteForm(true)}
              className="flex-shrink-0 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              Delete project
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              This action <strong>cannot be undone</strong>. This will permanently delete the{' '}
              <strong>{project.name}</strong> project and all associated data.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Type <strong>{project.name}</strong> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => { setDeleteConfirmText(e.target.value); setDeleteError('') }}
                placeholder={project.name}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => { setShowDeleteForm(false); setDeleteConfirmText(''); setDeleteError('') }}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteConfirmText !== project.name || deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40"
              >
                {deleting ? 'Deleting…' : 'Delete this project'}
              </button>
            </div>
          </div>
        )}
      </section>

      {showRegenerateModal && (
        <RegenerateKeyModal
          projectId={project.id}
          onClose={() => setShowRegenerateModal(false)}
        />
      )}
    </div>
  )
}
