#!/usr/bin/env node

import { createRequire } from "module";
import { program } from "commander";
import * as cron from "node-cron";
import { UsageCollector } from "./collector.js";
import { ConfigManager, formatSchedule } from "./config.js";
import { formatAgentList } from "./agents.js";
import { InteractiveConfig } from "./interactive-config.js";

const { version } = createRequire(import.meta.url)("../package.json");
const configManager = new ConfigManager();

function requireConfig() {
  const config = configManager.loadConfig();
  if (!config) {
    throw new Error(
      "Set MYCCUSAGE_API_KEY and MYCCUSAGE_ENDPOINT in the environment, or run ccusage-collector config.",
    );
  }
  return config;
}

program
  .name("ccusage-collector")
  .description("Collect and sync coding agent usage statistics")
  .version(version);

program
  .command("config")
  .description("Configure API credentials and sync settings")
  .action(() => new InteractiveConfig().runConfigurationWizard());

program
  .command("start")
  .description("Start scheduled sync")
  .action(async () => {
    const config = requireConfig();
    const collector = new UsageCollector(config);
    console.log(
      `🚀 Starting scheduled sync: ${formatSchedule(config.schedule)}`,
    );
    console.log(`📋 Schedule: ${config.schedule}`);
    console.log(`🤖 Agents: ${formatAgentList(config.agentTypes)}`);

    async function sync() {
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
    }
    await sync();
    const task = cron.schedule(config.schedule, sync, { noOverlap: true });
    console.log("\n🔄 Scheduled sync is running. Press Ctrl+C to stop.");
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        task.stop();
        process.exit(0);
      });
    }
  });

program
  .command("sync")
  .description("Run a single sync operation")
  .option("--dry-run", "Collect data but don't sync to server")
  .action(async (options: { dryRun?: boolean }) => {
    const config = requireConfig();
    const collector = new UsageCollector(config);
    if (options.dryRun) {
      console.log(
        `🧪 Dry run mode: collecting data for ${formatAgentList(config.agentTypes)}`,
      );
      const data = await collector.collectAllUsageData();
      if (data.length === 0)
        throw new Error("No usage data collected for any agent");
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    console.log(
      `⏳ Running single sync for ${formatAgentList(config.agentTypes)}...`,
    );
    await collector.run();
    console.log("✅ Sync completed successfully");
  });

program
  .command("status")
  .description("Check configuration status")
  .action(() => {
    const config = requireConfig();
    console.log("✅ Configuration found");
    console.log(
      configManager.hasConfig()
        ? `📁 Config file: ${configManager.getConfigPath()}`
        : "📁 No config file (using environment and defaults)",
    );
    console.log(`🤖 Agents: ${formatAgentList(config.agentTypes)}`);
    console.log(`📱 Device ID: ${config.deviceId}`);
    console.log(`📱 Device name: ${config.deviceName}`);
    if (config.displayName)
      console.log(`📱 Display name: ${config.displayName}`);
    console.log("🔑 API Key: set");
    console.log(`🌐 Endpoint: ${config.endpoint}`);
    console.log(
      `⏰ Schedule: ${formatSchedule(config.schedule)} (${config.schedule})`,
    );
    console.log(`🔄 Max retries: ${config.maxRetries}`);
    console.log(`⏱️ Retry delay: ${config.retryDelay}ms`);
  });

program
  .command("test")
  .description("Test data collection and endpoint connectivity")
  .action(async () => {
    const collector = new UsageCollector(requireConfig());
    const data = await collector.collectAllUsageData();
    if (data.length === 0)
      throw new Error("No usage data collected for any agent");
    for (const usage of data) await collector.syncData(usage);
    console.log("✅ Test completed successfully!");
  });

program.action(() => program.outputHelp());

program.parseAsync().catch((error: unknown) => {
  console.error(
    "❌",
    error instanceof Error ? error.message : "Command failed",
  );
  process.exitCode = 1;
});
