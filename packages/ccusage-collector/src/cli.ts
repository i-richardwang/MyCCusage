#!/usr/bin/env node

import { program } from 'commander'
import * as cron from 'node-cron'
import { UsageCollector } from './collector.js'
import type { CollectorConfig } from './types.js'

program
  .name('ccusage-collector')
  .description('Collect and sync Claude Code usage statistics')
  .version('0.2.0')

program
  .option('-k, --api-key <key>', 'API key for authentication')
  .option('-e, --endpoint <url>', 'API endpoint URL')
  .option('-s, --schedule <cron>', `Cron schedule for periodic sync
Examples:
  "0 */4 * * *"    - Every 4 hours
  "*/10 * * * *"   - Every 10 minutes`)
  .option('-r, --max-retries <number>', 'Maximum number of retry attempts', '3')
  .option('-d, --retry-delay <ms>', 'Delay between retry attempts in milliseconds', '1000')
  .option('--dry-run', 'Collect data but don\'t sync to server')
  .action(async (options) => {
    // Validate required options
    if (!options.apiKey) {
      console.error('Error: API key is required (--api-key)')
      process.exit(1)
    }
    
    if (!options.endpoint) {
      console.error('Error: API endpoint is required (--endpoint)')
      process.exit(1)
    }

    const config: CollectorConfig = {
      apiKey: options.apiKey,
      endpoint: options.endpoint,
      maxRetries: parseInt(options.maxRetries),
      retryDelay: parseInt(options.retryDelay)
    }

    const collector = new UsageCollector(config)

    if (options.dryRun) {
      console.log('Dry run mode: collecting data only')
      try {
        const data = await collector.collectUsageData()
        console.log('Collected data:', JSON.stringify(data, null, 2))
      } catch (error) {
        console.error('Failed to collect data:', error instanceof Error ? error.message : error)
        process.exit(1)
      }
      return
    }

    if (options.schedule) {
      console.log(`Starting scheduled sync with cron: ${options.schedule}`)
      
      // Validate cron expression
      if (!cron.validate(options.schedule)) {
        console.error('Error: Invalid cron expression')
        process.exit(1)
      }
      
      // Run once immediately
      console.log('Running initial sync...')
      await collector.run()
      
      // Schedule periodic runs
      cron.schedule(options.schedule, async () => {
        console.log(`\n[${new Date().toISOString()}] Running scheduled sync...`)
        await collector.run()
      })
      
      console.log('Scheduled sync is running. Press Ctrl+C to stop.')
      
      // Keep the process running
      process.on('SIGINT', () => {
        console.log('\nStopping scheduled sync...')
        process.exit(0)
      })
    } else {
      // Run once
      await collector.run()
    }
  })

program.parse()