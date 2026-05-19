'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import type { ApiResponse, CreateProjectResponse } from '@pulse/types'

interface CreateProjectModalProps {
  onClose: () => void
}

type Step = 'form' | 'reveal'

export default function CreateProjectModal({ onClose }: CreateProjectModalProps) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('form')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [createdProject, setCreatedProject] = useState<CreateProjectResponse | null>(null)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    setLoading(true)
    setError('')

    try {
      const res = await apiFetch<ApiResponse<CreateProjectResponse>>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      })

      if (res.success && res.data) {
        setCreatedProject(res.data)
        setStep('reveal')
      } else {
        setError('Failed to create project. Please try again.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  function copyKey() {
    if (!createdProject) return
    navigator.clipboard.writeText(createdProject.apiKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function handleDone() {
    if (createdProject) {
      router.refresh()
      router.push(`/dashboard?project=${createdProject.projectId}`)
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-xl">
        {step === 'form' ? (
          <>
            <div className="border-b border-gray-100 px-6 py-5">
              <h2 className="text-xl font-semibold text-gray-900">Create a project</h2>
              <p className="mt-1 text-sm text-gray-500">
                Give your project a name. An API key will be generated for you.
              </p>
            </div>
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Project name
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My API"
                  autoFocus
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !name.trim()}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-150"
                >
                  {loading ? 'Creating...' : 'Create project'}
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <div className="border-b border-gray-100 px-6 py-5">
              <h2 className="text-xl font-semibold text-gray-900">
                {createdProject?.name} created
              </h2>
              <p className="mt-1 text-sm text-gray-500">Your project is ready to use.</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3">
                <p className="text-xs font-bold text-yellow-900 uppercase tracking-wide">
                  DEV ONLY — Remove before production
                </p>
                <p className="mt-1 text-xs text-yellow-800">
                  This one-time key display will be removed before launch. Use the "Regenerate & Show API Key" button on the dashboard if you miss it.
                </p>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs font-medium text-amber-800">
                  Copy this API key now. You will not be able to see it again.
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-500">
                  API Key
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-800">
                    {createdProject?.apiKey}
                  </code>
                  <button
                    onClick={copyKey}
                    className="flex-shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors duration-150"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button
                  onClick={handleDone}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors duration-150"
                >
                  Go to dashboard
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
