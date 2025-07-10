"use client"

import { useEffect, useState } from 'react'

interface DailyRecord {
  date: string
  totalCost: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  modelsUsed: string[]
  createdAt: Date
}

interface UsageStats {
  totals: {
    totalCost: number
    totalTokens: number
    totalInputTokens: number
    totalOutputTokens: number
    totalCacheCreationTokens: number
    totalCacheReadTokens: number
    recordCount: number
    avgDailyCost: number
  }
  daily: DailyRecord[]
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