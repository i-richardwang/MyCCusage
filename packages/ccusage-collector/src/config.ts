import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface Config {
  apiKey: string
  endpoint: string
  schedule: string
  scheduleLabel: string
  maxRetries: number
  retryDelay: number
  deviceId?: string
  deviceName?: string
  displayName?: string
}

export const SCHEDULE_OPTIONS = [
  { value: '*/30 * * * *', label: 'Every 30 minutes' },
  { value: '0 * * * *', label: 'Every 1 hour' },
  { value: '0 */2 * * *', label: 'Every 2 hours' },
  { value: '0 */4 * * *', label: 'Every 4 hours' },
  { value: '0 */8 * * *', label: 'Every 8 hours' },
  { value: '0 0 * * *', label: 'Once daily' }
]

export class ConfigManager {
  private configDir: string
  private configPath: string

  constructor() {
    this.configDir = join(homedir(), '.ccusage-collector')
    this.configPath = join(this.configDir, 'config.json')
  }

  hasConfig(): boolean {
    return existsSync(this.configPath)
  }

  loadConfig(): Config | null {
    try {
      if (!this.hasConfig()) {
        return null
      }

      const configData = readFileSync(this.configPath, 'utf8')
      const config = JSON.parse(configData)
      
      // Validate required fields
      if (!config.apiKey || !config.endpoint) {
        return null
      }

      return {
        apiKey: config.apiKey,
        endpoint: config.endpoint,
        schedule: config.schedule || '0 */4 * * *',
        scheduleLabel: config.scheduleLabel || 'Every 4 hours',
        maxRetries: config.maxRetries || 3,
        retryDelay: config.retryDelay || 1000,
        deviceId: config.deviceId,
        deviceName: config.deviceName,
        displayName: config.displayName
      }
    } catch (error) {
      console.error('Failed to load config:', error)
      return null
    }
  }

  saveConfig(config: Config): void {
    try {
      // Ensure config directory exists
      if (!existsSync(this.configDir)) {
        mkdirSync(this.configDir, { recursive: true })
      }

      // Write config file
      writeFileSync(this.configPath, JSON.stringify(config, null, 2))
      
      // Set file permissions to 600 (user read/write only)
      chmodSync(this.configPath, 0o600)
      
      console.log('✅ Configuration saved successfully!')
    } catch (error) {
      console.error('Failed to save config:', error)
      throw error
    }
  }

  getConfigPath(): string {
    return this.configPath
  }

  updateDeviceInfo(deviceId: string, deviceName: string): void {
    try {
      const config = this.loadConfig()
      if (!config) {
        throw new Error('No configuration found')
      }

      const updatedConfig = {
        ...config,
        deviceId,
        deviceName
      }

      this.saveConfig(updatedConfig)
    } catch (error) {
      console.error('Failed to update device info:', error)
      throw error
    }
  }

  showNoConfigMessage(): void {
    console.log(`
❌ Configuration not found!

📋 Please run the following command to configure first:
   ccusage-collector config

💡 Then start with PM2:
   pm2 start ccusage-collector -- start
`)
  }
}