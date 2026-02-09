import { exec } from 'child_process'
import { promisify } from 'util'
import axios from 'axios'
import type { UsageData, SyncResult, CollectorConfig, AgentType, DailyUsageRecord } from './types.js'
import { getDeviceInfo } from './utils/device-info.js'

const execAsync = promisify(exec)

// User's login shell for alias support
const USER_SHELL = process.env.SHELL || '/bin/bash'

// Execute a command in the user's interactive shell (loads aliases from rc files)
async function execInShell(command: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(`${USER_SHELL} -ic ${JSON.stringify(command)}`)
}

// Extract JSON from stdout (interactive shells may prepend noise from rc files)
function extractJSON(stdout: string): string {
  const start = stdout.indexOf('{')
  if (start === -1) throw new Error('No JSON object found in output')
  // Find the matching closing brace
  let depth = 0
  for (let i = start; i < stdout.length; i++) {
    if (stdout[i] === '{') depth++
    else if (stdout[i] === '}') depth--
    if (depth === 0) return stdout.slice(start, i + 1)
  }
  throw new Error('Malformed JSON in output')
}

// Binary name → npm package name mapping per agent type
const AGENT_BIN: Record<AgentType, { bin: string; pkg: string }> = {
  'claude-code': { bin: 'ccusage', pkg: 'ccusage' },
  'amp': { bin: 'ccusage-amp', pkg: '@ccusage/amp' }
}

// Check if a command (or alias) exists in the user's shell
async function commandExists(bin: string): Promise<boolean> {
  try {
    await execInShell(`command -v ${bin}`)
    return true
  } catch {
    return false
  }
}

// Resolve the command to run: prefer local command/alias, fallback to npx
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

  // Collect usage data for a single agent type
  async collectUsageData(agentType?: AgentType): Promise<UsageData> {
    // If no explicit agentType, use the first configured one (backward compat)
    const agent = agentType || (this.config.agentTypes?.[0]) || 'claude-code'
    const command = await resolveCommand(agent)

    try {
      console.log(`Collecting ${agent} usage data via: ${command}`)
      const { stdout } = await execInShell(command)

      const rawData = JSON.parse(extractJSON(stdout))

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
      deviceInfo.agentType = agent

      const displayName = deviceInfo.displayName || deviceInfo.deviceName
      console.log(`Device: ${displayName} (${deviceInfo.deviceId})`)
      console.log(`Agent Type: ${agent}`)

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
        throw new Error(`Failed to collect ${agent} usage data: ${error.message}`)
      }
      throw new Error(`Failed to collect ${agent} usage data: Unknown error`)
    }
  }

  // Collect usage data for all configured agent types
  async collectAllUsageData(): Promise<UsageData[]> {
    const agentTypes = this.config.agentTypes || ['claude-code']
    const results: UsageData[] = []

    for (const agentType of agentTypes) {
      try {
        const data = await this.collectUsageData(agentType)
        results.push(data)
      } catch (error) {
        console.error(`Failed to collect ${agentType} data:`, error instanceof Error ? error.message : error)
        // Continue with other agents even if one fails
      }
    }

    return results
  }

  async syncData(data: UsageData): Promise<SyncResult> {
    const { endpoint, apiKey, maxRetries = 3, retryDelay = 1000 } = this.config

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Syncing ${data.device.agentType || 'claude-code'} data (attempt ${attempt}/${maxRetries})...`)

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
    const agentTypes = this.config.agentTypes || ['claude-code']
    let hasError = false

    for (const agentType of agentTypes) {
      try {
        console.log(`\n--- ${agentType} ---`)
        const data = await this.collectUsageData(agentType)
        await this.syncData(data)
        console.log(`${agentType} sync completed successfully`)
      } catch (error) {
        console.error(`${agentType} sync failed:`, error instanceof Error ? error.message : error)
        hasError = true
        // Continue with other agents
      }
    }

    if (hasError && agentTypes.length === 1) {
      process.exit(1)
    }
  }
}
