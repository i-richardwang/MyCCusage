import { exec } from 'child_process'
import { promisify } from 'util'
import axios from 'axios'
import type { UsageData, SyncResult, CollectorConfig, AgentType, DailyUsageRecord } from './types.js'
import { getDeviceInfo } from './utils/device-info.js'

const execAsync = promisify(exec)

// Binary name → npm package name mapping per agent type
const AGENT_BIN: Record<AgentType, { bin: string; pkg: string }> = {
  'claude-code': { bin: 'ccusage', pkg: 'ccusage' },
  'amp': { bin: 'ccusage-amp', pkg: '@ccusage/amp' }
}

// Check if a command exists globally
async function commandExists(bin: string): Promise<boolean> {
  try {
    await execAsync(`command -v ${bin}`)
    return true
  } catch {
    return false
  }
}

// Resolve the command to run: prefer global binary, fallback to npx
async function resolveCommand(agentType: AgentType): Promise<string> {
  const { bin, pkg } = AGENT_BIN[agentType]
  if (await commandExists(bin)) {
    return `${bin} daily --json`
  }
  return `npx ${pkg} daily --json`
}

// Map ccusage output fields to API expected fields
function mapCcusageRecord(record: Record<string, unknown>): DailyUsageRecord {
  return {
    date: record.date as string,
    inputTokens: (record.inputTokens as number) || 0,
    outputTokens: (record.outputTokens as number) || 0,
    // ccusage uses cacheCreationInputTokens, API expects cacheCreationTokens
    cacheCreationTokens: (record.cacheCreationInputTokens as number) || (record.cacheCreationTokens as number) || 0,
    // ccusage uses cacheReadInputTokens, API expects cacheReadTokens
    cacheReadTokens: (record.cacheReadInputTokens as number) || (record.cacheReadTokens as number) || 0,
    totalTokens: (record.totalTokens as number) || 0,
    // ccusage uses costUSD, API expects totalCost
    totalCost: (record.costUSD as number) || (record.totalCost as number) || 0,
    // AMP specific field
    credits: (record.credits as number) || 0,
    modelsUsed: (record.modelsUsed as string[]) || [],
    modelBreakdowns: (record.modelBreakdowns as DailyUsageRecord['modelBreakdowns']) || []
  }
}

export class UsageCollector {
  private config: CollectorConfig

  constructor(config: CollectorConfig) {
    this.config = {
      maxRetries: 3,
      retryDelay: 1000,
      ...config
    }
  }

  async collectUsageData(): Promise<UsageData> {
    const agentType = this.config.agentType || 'claude-code'
    const command = await resolveCommand(agentType)

    try {
      console.log(`Collecting ${agentType} usage data via: ${command}`)
      const { stdout } = await execAsync(command)

      const rawData = JSON.parse(stdout)

      if (!rawData.daily || !Array.isArray(rawData.daily)) {
        throw new Error('Invalid usage data format')
      }

      // Get device information
      const deviceInfo = getDeviceInfo()

      // Override displayName from collector config if provided
      if (this.config.displayName) {
        deviceInfo.displayName = this.config.displayName
      }

      // Set agent type
      deviceInfo.agentType = agentType

      const displayName = deviceInfo.displayName || deviceInfo.deviceName
      console.log(`Device: ${displayName} (${deviceInfo.deviceId})`)
      console.log(`Agent Type: ${agentType}`)

      // Map ccusage output fields to API expected fields
      const mappedDaily = rawData.daily.map((record: Record<string, unknown>) => mapCcusageRecord(record))

      // Combine raw data with device info
      const data: UsageData = {
        device: deviceInfo,
        daily: mappedDaily,
        totals: rawData.totals
      }

      console.log(`Collected ${data.daily.length} daily records`)
      return data
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to collect ${agentType} usage data: ${error.message}`)
      }
      throw new Error(`Failed to collect ${agentType} usage data: Unknown error`)
    }
  }

  async syncData(data: UsageData): Promise<SyncResult> {
    const { endpoint, apiKey, maxRetries = 3, retryDelay = 1000 } = this.config
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Syncing data (attempt ${attempt}/${maxRetries})...`)
        
        const response = await axios.post(endpoint, data, {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
          },
          timeout: 30000
        })

        const result: SyncResult = response.data
        
        if (result.success) {
          console.log(`Successfully synced ${result.processed} records`)
          
          // Log any errors for individual records
          const errors = result.results.filter(r => r.status === 'error')
          if (errors.length > 0) {
            console.warn(`${errors.length} records had errors:`)
            errors.forEach(error => {
              console.warn(`  - ${error.date}: ${error.message}`)
            })
          }
          
          return result
        } else {
          throw new Error('Sync failed: ' + JSON.stringify(result))
        }
      } catch (error) {
        const isLastAttempt = attempt === maxRetries
        
        if (axios.isAxiosError(error)) {
          const status = error.response?.status
          const message = error.response?.data?.error || error.message
          
          console.error(`Sync failed (attempt ${attempt}/${maxRetries}): ${status} - ${message}`)
          
          // Don't retry on authentication errors
          if (status === 401 || status === 403) {
            throw new Error(`Authentication failed: ${message}`)
          }
          
          if (isLastAttempt) {
            throw new Error(`Sync failed after ${maxRetries} attempts: ${message}`)
          }
        } else {
          console.error(`Sync failed (attempt ${attempt}/${maxRetries}):`, error)
          
          if (isLastAttempt) {
            throw error
          }
        }
        
        // Wait before retrying
        if (!isLastAttempt) {
          console.log(`Retrying in ${retryDelay}ms...`)
          await new Promise(resolve => setTimeout(resolve, retryDelay))
        }
      }
    }
    
    throw new Error('Sync failed after all retries')
  }

  async run(): Promise<void> {
    try {
      const data = await this.collectUsageData()
      await this.syncData(data)
      console.log('Usage data sync completed successfully')
    } catch (error) {
      console.error('Usage data sync failed:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  }
}