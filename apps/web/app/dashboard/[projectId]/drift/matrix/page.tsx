import { fetchMatrixServer } from '../fetchers'
import MatrixView from './MatrixView'

export const dynamic = 'force-dynamic'

export default async function DriftMatrixPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const matrix = await fetchMatrixServer(projectId)

  if (!matrix) {
    return (
      <div className="max-w-7xl mx-auto p-8">
        <h1 className="text-xl font-semibold text-gray-900">Drift Matrix</h1>
        <div className="mt-6 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
          <p className="text-sm text-gray-500">Could not load matrix. Send a snapshot to get started.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-[90rem] mx-auto p-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Drift Matrix</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {matrix.rows.length} keys across {matrix.environments.length} environments
        </p>
      </div>
      <MatrixView projectId={projectId} matrix={matrix} />
    </div>
  )
}
