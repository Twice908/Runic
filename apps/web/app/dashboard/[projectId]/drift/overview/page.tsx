import { fetchEventsServer, fetchMatrixServer } from '../fetchers'
import OverviewClient from './OverviewClient'

export const dynamic = 'force-dynamic'

const RECENT_LIMIT = 5

export default async function DriftOverviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params

  const [matrix, events] = await Promise.all([
    fetchMatrixServer(projectId),
    fetchEventsServer(projectId, { resolved: false, limit: RECENT_LIMIT }),
  ])

  return (
    <OverviewClient
      projectId={projectId}
      initialEnvironments={matrix?.environments ?? []}
      initialEvents={events?.events ?? []}
      initialRows={matrix?.rows ?? []}
    />
  )
}
