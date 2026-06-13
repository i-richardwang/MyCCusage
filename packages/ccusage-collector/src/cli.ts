#!/usr/bin/env node

import { program } from "commander";
import * as cron from "node-cron";
import { UsageCollector } from "./collector.js";
import { ConfigManager, AGENT_OPTIONS } from "./config.js";
import { InteractiveConfig } from "./interactive-config.js";
import type { CollectorConfig } from "./types.js";

const configManager = new ConfigManager();

function formatAgentList(agentTypes: string[]): string {
  return agentTypes
    .map((t) => AGENT_OPTIONS.find((o) => o.value === t)?.label || t)
    .join(", ");
}

program
  .name("ccusage-collector")
  .description("Collect and sync coding agent usage statistics")
  .version("0.5.4");

// Config command - Interactive configuration
program
  .command("config")
  .description("Configure API credentials and sync settings")
  .action(async () => {
    const interactiveConfig = new InteractiveConfig();
    await interactiveConfig.runConfigurationWizard();
  });

// Start command - Start scheduled sync
program
  .command("start")
  .description("Start scheduled sync (requires configuration)")
  .action(async () => {
    const config = configManager.loadConfig();

    if (!config) {
      configManager.showNoConfigMessage();
      process.exit(1);
    }

    const collectorConfig: CollectorConfig = {
      apiKey: config.apiKey,
      endpoint: config.endpoint,
      displayName: config.displayName,
      agentTypes: config.agentTypes,
      maxRetries: config.maxRetries,
      retryDelay: config.retryDelay,
    };

    const collector = new UsageCollector(collectorConfig);
    const agents = config.agentTypes || ["claude-code"];

    console.log(`🚀 Starting scheduled sync: ${config.scheduleLabel}`);
    console.log(`📋 Schedule: ${config.schedule}`);
    console.log(`🤖 Agents: ${formatAgentList(agents)}`);

    // Validate cron expression
    if (!cron.validate(config.schedule)) {
      console.error("❌ Invalid cron expression in configuration");
      process.exit(1);
    }

    // Run once immediately
    console.log("\n⏳ Running initial sync...");
    try {
      await collector.run();
      console.log("✅ Initial sync completed");
    } catch (error) {
      console.error(
        "❌ Initial sync failed:",
        error instanceof Error ? error.message : error,
      );
      // Continue with scheduling even if initial sync fails
    }

    // Schedule periodic runs
    cron.schedule(config.schedule, async () => {
      console.log(
        `\n[${new Date().toISOString()}] ⏳ Running scheduled sync...`,
      );
      try {
        await collector.run();
        console.log("✅ Scheduled sync completed");
      } catch (error) {
        console.error(
          "❌ Scheduled sync failed:",
          error instanceof Error ? error.message : error,
        );
      }
    });

    console.log("\n🔄 Scheduled sync is running. Press Ctrl+C to stop.");

    // Keep the process running
    process.on("SIGINT", () => {
      console.log("\n🛑 Stopping scheduled sync...");
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      console.log("\n🛑 Received SIGTERM, stopping scheduled sync...");
      process.exit(0);
    });
  });

// Sync command - Run single sync
program
  .command("sync")
  .description("Run a single sync operation")
  .option("--dry-run", "Collect data but don't sync to server")
  .action(async (options) => {
    const config = configManager.loadConfig();

    if (!config) {
      configManager.showNoConfigMessage();
      process.exit(1);
    }

    const collectorConfig: CollectorConfig = {
      apiKey: config.apiKey,
      endpoint: config.endpoint,
      displayName: config.displayName,
      agentTypes: config.agentTypes,
      maxRetries: config.maxRetries,
      retryDelay: config.retryDelay,
    };

    const collector = new UsageCollector(collectorConfig);
    const agents = config.agentTypes || ["claude-code"];

    if (options.dryRun) {
      console.log(
        `🧪 Dry run mode: collecting data for ${formatAgentList(agents)}`,
      );
      try {
        const allData = await collector.collectAllUsageData();
        console.log("📊 Collected data:");
        console.log(JSON.stringify(allData, null, 2));
      } catch (error) {
        console.error(
          "❌ Failed to collect data:",
          error instanceof Error ? error.message : error,
        );
        process.exit(1);
      }
      return;
    }

    console.log(`⏳ Running single sync for ${formatAgentList(agents)}...`);
    try {
      await collector.run();
      console.log("✅ Sync completed successfully");
    } catch (error) {
      console.error(
        "❌ Sync failed:",
        error instanceof Error ? error.message : error,
      );
      process.exit(1);
    }
  });

// Status command - Check configuration and status
program
  .command("status")
  .description("Check configuration status")
  .action(() => {
    const config = configManager.loadConfig();

    if (!config) {
      console.log("❌ No configuration found");
      console.log(`📁 Expected location: ${configManager.getConfigPath()}`);
      console.log("\n📋 Run configuration:");
      console.log("   ccusage-collector config");
      return;
    }

    const agents = config.agentTypes || ["claude-code"];

    console.log("✅ Configuration found");
    console.log(`📁 Config file: ${configManager.getConfigPath()}`);
    console.log(`🤖 Agents: ${formatAgentList(agents)}`);
    console.log(`🌐 Endpoint: ${config.endpoint}`);
    console.log(`⏰ Schedule: ${config.scheduleLabel} (${config.schedule})`);
    console.log(`🔄 Max retries: ${config.maxRetries}`);
    console.log(`⏱️  Retry delay: ${config.retryDelay}ms`);

    console.log("\n💡 Available commands:");
    console.log("   ccusage-collector sync     # Run single sync");
    console.log("   ccusage-collector start    # Start scheduled sync");
  });

// Test command - Test configuration and connection
program
  .command("test")
  .description("Test configuration and connection")
  .action(async () => {
    const config = configManager.loadConfig();

    if (!config) {
      configManager.showNoConfigMessage();
      process.exit(1);
    }

    const collectorConfig: CollectorConfig = {
      apiKey: config.apiKey,
      endpoint: config.endpoint,
      displayName: config.displayName,
      agentTypes: config.agentTypes,
      maxRetries: config.maxRetries,
      retryDelay: config.retryDelay,
    };

    const collector = new UsageCollector(collectorConfig);
    const agents = config.agentTypes || ["claude-code"];

    console.log(`🧪 Testing configuration for ${formatAgentList(agents)}...`);

    try {
      console.log(`📊 Testing data collection...`);
      const allData = await collector.collectAllUsageData();

      if (allData.length === 0) {
        console.log(
          `⚠️  No usage data found for any agent. Make sure the tools are installed.`,
        );
      } else {
        const totalRecords = allData.reduce(
          (sum, d) => sum + d.daily.length,
          0,
        );
        console.log(
          `✅ Found ${totalRecords} total daily records across ${allData.length} agent(s)`,
        );
      }

      console.log("🌐 Testing connection to endpoint...");
      console.log("⏳ Running test sync...");

      await collector.run();
      console.log("✅ Test completed successfully!");
    } catch (error) {
      console.error(
        "❌ Test failed:",
        error instanceof Error ? error.message : error,
      );
      process.exit(1);
    }
  });

// Default action (no command specified)
program.action(() => {
  console.log("ccusage-collector - Coding Agent Usage Statistics Collector\n");

  const config = configManager.loadConfig();

  if (!config) {
    console.log("❌ No configuration found\n");
    console.log("🔧 Get started:");
    console.log(
      "   ccusage-collector config   # Configure credentials and settings",
    );
    console.log("");
    console.log("📚 Other commands:");
    console.log("   ccusage-collector --help   # Show all available commands");
  } else {
    console.log("✅ Configuration found\n");
    console.log("🚀 Common commands:");
    console.log("   ccusage-collector sync      # Run single sync");
    console.log("   ccusage-collector start     # Start scheduled sync");
    console.log("   ccusage-collector status    # Check status");
    console.log("   ccusage-collector test      # Test configuration");
    console.log("");
    console.log("📚 Other commands:");
    console.log("   ccusage-collector --help    # Show all available commands");
  }
});

program.parse();
