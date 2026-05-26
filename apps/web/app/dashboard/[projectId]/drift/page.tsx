import { redirect } from 'next/navigation'

export default async function DriftIndexPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  redirect(`/dashboard/${projectId}/drift/overview`)
}
