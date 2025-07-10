import { exec } from 'child_process'
import { promisify } from 'util'
import axios from 'axios'
import type { UsageData, SyncResult, CollectorConfig } from './types.js'
import { getDeviceInfo } from './utils/device-info.js'

const execAsync = promisify(exec)

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
    try {
      console.log('Collecting usage data...')
      const { stdout } = await execAsync('npx ccusage daily --json')
      
      const rawData = JSON.parse(stdout)
      
      if (!rawData.daily || !Array.isArray(rawData.daily)) {
        throw new Error('Invalid usage data format')
      }
      
      // Get device information
      const deviceInfo = getDeviceInfo()
      console.log(`Device: ${deviceInfo.deviceName} (${deviceInfo.deviceId})`)
      
      // Combine raw data with device info
      const data: UsageData = {
        device: deviceInfo,
        daily: rawData.daily,
        totals: rawData.totals
      }
      
      console.log(`Collected ${data.daily.length} daily records`)
      return data
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to collect usage data: ${error.message}`)
      }
      throw new Error('Failed to collect usage data: Unknown error')
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