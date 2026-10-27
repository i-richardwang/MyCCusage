#!/usr/bin/env node

import { createRequire } from "module";
import { program } from "commander";
import { UsageCollector } from "./collector.js";
import { ConfigManager, formatSchedule, requireConfig } from "./config.js";
import { formatAgentList } from "./agents.js";
import { InteractiveConfig } from "./interactive-config.js";
import { CollectorService } from "./service.js";
import { acquireLock } from "./runtime-state.js";
import { runSync } from "./sync.js";

const { version } = createRequire(import.meta.url)("../package.json");
const configManager = new ConfigManager();

program
  .name("ccusage-collector")
  .description("Collect and sync coding agent usage statistics")
  .version(version);

program
  .command("config")
  .description("Configure API credentials and sync settings")
  .action(() => new InteractiveConfig().runConfigurationWizard());

program
  .command("sync")
  .description("Run a single sync operation")
  .option("--dry-run", "Collect data but don't sync to server")
  .action(async (options: { dryRun?: boolean }) => runSync(options));

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
    const release = await acquireLock("sync");
    try {
      const data = await collector.collectAllUsageData();
      if (data.length === 0)
        throw new Error("No usage data collected for any agent");
      for (const usage of data) await collector.syncData(usage);
      console.log("✅ Test completed successfully!");
    } finally {
      await release();
    }
  });

const service = program
  .command("service")
  .description("Manage native scheduled sync (macOS / Linux)");

service
  .command("install")
  .description("Install or update the user-level scheduled task")
  .action(async () => {
    await new CollectorService().install(requireConfig());
    console.log(
      "✅ Scheduled sync installed. Check ccusage-collector service status and service logs.",
    );
    if (process.platform === "linux") {
      console.log(
        "To keep the user timer running after logout, enable lingering with: loginctl enable-linger",
      );
    }
  });

service
  .command("uninstall")
  .description("Remove the scheduled task and saved service environment")
  .action(async () => {
    await new CollectorService().uninstall();
    console.log(
      "✅ Scheduled sync uninstalled. Configuration and sync history preserved.",
    );
  });

service
  .command("status")
  .description("Inspect OS registration and the latest sync result")
  .option("--json", "Print machine-readable status")
  .action(async (options: { json?: boolean }) => {
    const status = await new CollectorService().status();
    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    console.log(`Scheduler: ${status.backend}`);
    console.log(`Installed: ${status.installed ? "yes" : "no"}`);
    console.log(`Active: ${status.active ? "yes" : "no"}`);
    console.log(`Enabled: ${status.enabled ? "yes" : "no"}`);
    if (status.schedule) console.log(`Installed schedule: ${status.schedule}`);
    if (status.installed && !status.pathsValid)
      console.log(
        "⚠️ Service files or runtime paths are missing. Reinstall the service.",
      );
    if (status.lastSync) {
      console.log(
        `Last sync: ${status.lastSync.result} (${status.lastSync.finishedAt ?? status.lastSync.startedAt})`,
      );
      if (status.lastSync.lastSuccessAt)
        console.log(`Last full success: ${status.lastSync.lastSuccessAt}`);
      if (status.lastSync.failedAgents?.length)
        console.log(
          `Failed agents: ${status.lastSync.failedAgents.join(", ")}`,
        );
      if (status.lastSync.error)
        console.log(`Last error: ${status.lastSync.error}`);
    }
  });

service
  .command("logs")
  .description("Show the latest 100 scheduled-sync log lines")
  .option("-f, --follow", "Follow new log output")
  .action(async (options: { follow?: boolean }) =>
    new CollectorService().logs(Boolean(options.follow)),
  );

program.action(() => program.outputHelp());

program.parseAsync().catch((error: unknown) => {
  console.error(
    "❌",
    error instanceof Error ? error.message : "Command failed",
  );
  process.exitCode = 1;
});
