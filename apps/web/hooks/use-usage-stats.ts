"use client"

import { useEffect, useState } from 'react'
import type { UsageStatsResponse } from '@/types/api-types'

export function useUsageStats() {
  const [stats, setStats] = useState<UsageStatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchStats() {
      try {
        setLoading(true)
        const response = await fetch('/api/usage-stats')

        if (!response.ok) {
          throw new Error('Failed to fetch usage statistics')
        }

        const data: UsageStatsResponse = await response.json()
        setStats(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [])

  return { stats, loading, error }
}
