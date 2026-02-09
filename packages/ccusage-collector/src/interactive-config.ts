import inquirer from 'inquirer'
import { ConfigManager, Config, SCHEDULE_OPTIONS, AGENT_OPTIONS } from './config.js'
import { UsageCollector } from './collector.js'
import type { AgentType } from './types.js'

export class InteractiveConfig {
  private configManager: ConfigManager

  constructor() {
    this.configManager = new ConfigManager()
  }

  async runConfigurationWizard(): Promise<void> {
    console.log('\n🔧 ccusage-collector Configuration Wizard')
    console.log('=========================================\n')

    try {
      // Load existing config if available
      const existingConfig = this.configManager.loadConfig()

      if (existingConfig) {
        console.log('✅ Found existing configuration')

        const { shouldReconfigure } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'shouldReconfigure',
            message: 'Do you want to reconfigure?',
            default: false
          }
        ])

        if (!shouldReconfigure) {
          console.log('Configuration unchanged.')
          return
        }
      }

      // Get agent selection first (checkbox prompt)
      const { agentTypes } = await inquirer.prompt({
        type: 'checkbox',
        name: 'agentTypes' as const,
        message: 'Select the coding agents to track (space to select, enter to confirm):',
        choices: AGENT_OPTIONS.map(option => ({
          name: option.label,
          value: option.value,
          checked: existingConfig
            ? existingConfig.agentTypes?.includes(option.value) ?? false
            : option.value === 'claude-code'
        })),
        validate: (input: readonly unknown[]) => {
          if (input.length === 0) {
            return 'Please select at least one agent'
          }
          return true
        }
      })

      // Get remaining configuration
      const answers = await inquirer.prompt([
        {
          type: 'password',
          name: 'apiKey',
          message: 'Enter your API Key:',
          mask: '*',
          default: existingConfig?.apiKey,
          validate: (input: string) => {
            if (!input || input.trim().length === 0) {
              return 'API Key is required'
            }
            return true
          }
        },
        {
          type: 'input',
          name: 'baseUrl',
          message: 'Enter your dashboard URL (domain only):',
          default: existingConfig ? existingConfig.endpoint.replace('/api/usage-sync', '') : 'https://your-app.com',
          validate: (input: string) => {
            if (!input || input.trim().length === 0) {
              return 'Dashboard URL is required'
            }
            try {
              new URL(input)
              return true
            } catch {
              return 'Please enter a valid URL (e.g., https://your-app.com)'
            }
          }
        },
        {
          type: 'input',
          name: 'displayName',
          message: 'Enter a custom device name (optional, leave empty to use system name):',
          default: existingConfig?.displayName || '',
          validate: (input: string) => {
            // Allow empty string, but if provided, should not be just whitespace
            if (input && input.trim().length === 0) {
              return 'Device name cannot be just whitespace. Leave empty to use system name.'
            }
            return true
          }
        },
        {
          type: 'list',
          name: 'scheduleOption',
          message: 'Select sync frequency:',
          choices: SCHEDULE_OPTIONS.map(option => ({
            name: option.label,
            value: option
          })),
          default: existingConfig
            ? SCHEDULE_OPTIONS.find(opt => opt.value === existingConfig.schedule)
            : SCHEDULE_OPTIONS[3] // Default to "Every 4 hours"
        }
      ])

      // Build configuration with auto-generated endpoint
      const baseUrl = answers.baseUrl.trim().replace(/\/$/, '') // Remove trailing slash
      const endpoint = `${baseUrl}/api/usage-sync`

      const config: Config = {
        apiKey: answers.apiKey.trim(),
        endpoint: endpoint,
        schedule: answers.scheduleOption.value,
        scheduleLabel: answers.scheduleOption.label,
        maxRetries: existingConfig?.maxRetries || 3,
        retryDelay: existingConfig?.retryDelay || 1000,
        // Device info will be auto-generated when first needed
        deviceId: existingConfig?.deviceId,
        deviceName: existingConfig?.deviceName,
        displayName: answers.displayName.trim() || undefined,
        agentTypes: agentTypes as AgentType[]
      }

      // Test configuration
      console.log('\n🧪 Testing configuration...')
      const testResult = await this.testConfiguration(config)

      if (!testResult.success) {
        console.log('❌ Configuration test failed:', testResult.error)

        const { shouldSaveAnyway } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'shouldSaveAnyway',
            message: 'Save configuration anyway?',
            default: false
          }
        ])

        if (!shouldSaveAnyway) {
          console.log('Configuration cancelled.')
          return
        }
      } else {
        console.log('✅ Configuration test passed!')
      }

      // Save configuration
      this.configManager.saveConfig(config)

      const agentLabels = (config.agentTypes || [])
        .map(t => AGENT_OPTIONS.find(o => o.value === t)?.label || t)
        .join(', ')

      console.log('\n📋 Configuration Summary:')
      console.log(`   Agents: ${agentLabels}`)
      console.log(`   API Endpoint: ${config.endpoint}`)
      console.log(`   Sync Schedule: ${config.scheduleLabel}`)
      if (config.displayName) {
        console.log(`   Device Display Name: ${config.displayName}`)
      }
      console.log(`   Config saved to: ${this.configManager.getConfigPath()}`)

      console.log('\n💡 Start with PM2:')
      console.log('   pm2 start ccusage-collector -- start')

    } catch (error) {
      console.error('Configuration failed:', error)
      process.exit(1)
    }
  }

  private async testConfiguration(config: Config): Promise<{ success: boolean; error?: string }> {
    try {
      const collector = new UsageCollector({
        apiKey: config.apiKey,
        endpoint: config.endpoint,
        displayName: config.displayName,
        agentTypes: config.agentTypes,
        maxRetries: 1,
        retryDelay: 1000
      })

      // Test data collection for all configured agents
      const allData = await collector.collectAllUsageData()

      if (allData.length === 0) {
        const agentLabels = (config.agentTypes || [])
          .map(t => AGENT_OPTIONS.find(o => o.value === t)?.label || t)
          .join(', ')
        return { success: false, error: `No usage data found for any agent (${agentLabels}). Make sure the tools are installed.` }
      }

      const emptyAgents = (config.agentTypes || []).filter(
        t => !allData.some(d => d.device.agentType === t)
      )
      if (emptyAgents.length > 0) {
        const labels = emptyAgents.map(t => AGENT_OPTIONS.find(o => o.value === t)?.label || t).join(', ')
        console.log(`⚠️  No data found for: ${labels} (will be retried on next sync)`)
      }

      console.log('✅ Data collection test passed')

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}
