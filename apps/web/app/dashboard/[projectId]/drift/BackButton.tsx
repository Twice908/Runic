'use client'

import { useRouter } from 'next/navigation'

export default function BackButton() {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
    >
      <span aria-hidden>←</span> Back
    </button>
  )
}
