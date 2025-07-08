"use client"

import { useEffect, useState } from 'react'

interface UsageStats {
  totalCost: number
  totalTokens: number
  recordCount: number
}

export function useUsageStats() {
  const [stats, setStats] = useState<UsageStats | null>(null)
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
        
        const data = await response.json()
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