'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'
import type { ProjectSummary } from '@pulse/types'

interface SidebarProps {
  projects: ProjectSummary[]
}

const NAV_ITEMS = [
  { label: 'Overview', href: '/dashboard' },
  { label: 'Live Logs', href: '/dashboard/logs' },
  { label: 'Analytics', href: '/dashboard/analytics' },
  { label: 'Errors', href: '/dashboard/errors' },
  { label: 'Alerts', href: '/dashboard/alerts' },
  { label: 'Uptime', href: '/dashboard/uptime' },
  { label: 'Rate Limiter', href: '/dashboard/rate-limiter' },
  { label: 'Settings', href: '/dashboard/settings' },
]

export default function Sidebar({ projects }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectedProjectId = searchParams.get('project') ?? projects[0]?.id ?? ''

  function navigate(href: string) {
    const params = new URLSearchParams()
    if (selectedProjectId) params.set('project', selectedProjectId)
    router.push(`${href}?${params.toString()}`)
  }

  function selectProject(id: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('project', id)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <aside
      className="flex h-screen w-64 flex-shrink-0 flex-col"
      style={{ backgroundColor: '#0f1117' }}
    >
      {/* Logo */}
      <div className="flex h-16 items-center px-6 border-b border-white/10">
        <span className="text-lg font-bold text-white tracking-tight">Pulse</span>
        <span className="ml-2 rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white">
          beta
        </span>
      </div>

      {/* Project selector */}
      {projects.length > 0 && (
        <div className="px-4 py-4 border-b border-white/10">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            Project
          </p>
          <select
            value={selectedProjectId}
            onChange={(e) => selectProject(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id} className="bg-gray-900 text-gray-200">
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === '/dashboard'
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <button
              key={item.href}
              onClick={() => navigate(item.href)}
              className={[
                'flex w-full items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150',
                isActive
                  ? 'bg-[#1e293b] text-white border-l-2 border-indigo-500 pl-[10px]'
                  : 'text-gray-400 hover:bg-white/5 hover:text-gray-200',
              ].join(' ')}
            >
              {item.label}
            </button>
          )
        })}
      </nav>

      {/* User */}
      <div className="border-t border-white/10 p-4">
        <UserButton
          appearance={{
            elements: {
              avatarBox: 'w-8 h-8',
              userButtonTrigger: 'focus:ring-indigo-500',
            },
          }}
        />
      </div>
    </aside>
  )
}
