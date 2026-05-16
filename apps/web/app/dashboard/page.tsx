import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const { userId } = auth()
  if (!userId) {
    redirect('/')
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard coming soon</h1>
      <p className="mt-2 text-gray-600">Your observability data will appear here.</p>
    </main>
  )
}
