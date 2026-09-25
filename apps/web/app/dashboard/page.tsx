'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import StatsCards from '@/components/StatsCards'
import LogTable from '@/components/LogTable'
import CreateProjectModal from '@/components/CreateProjectModal'
import { apiFetch } from '@/lib/api'
import type { ProjectSummary } from '@runic/types'

export default function DashboardPage() {
  const searchParams = useSearchParams()
  const projectId = searchParams.get('project')

  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch<{ projects: ProjectSummary[] }>('/api/projects')
      .then((d) => setProjects(d.projects))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="p-8">
        <div className="h-6 w-48 animate-runic rounded bg-gray-200" />
        <div className="mt-6 grid grid-cols-4 gap-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-runic rounded-xl bg-gray-100" />
          ))}
        </div>
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50">
            <svg className="h-8 w-8 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">No projects yet</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
            Create your first project to start ingesting request logs.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="mt-6 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors duration-150"
          >
            Create project
          </button>
        </div>
        {showModal && <CreateProjectModal onClose={() => setShowModal(false)} />}
      </div>
    )
  }

  const activeProjectId = projectId ?? projects[0]?.id ?? ''

  return (
    <div className="max-w-7xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Overview</h1>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors duration-150"
        >
          New project
        </button>
      </div>

      {activeProjectId && (
        <div className="space-y-8">
          <StatsCards projectId={activeProjectId} />
          <LogTable projectId={activeProjectId} />
        </div>
      )}

      {showModal && <CreateProjectModal onClose={() => setShowModal(false)} />}
    </div>
  )
}
