import inquirer from "inquirer";
import {
  ConfigManager,
  type Config,
  CONFIG_DEFAULTS,
  SCHEDULE_OPTIONS,
  readEnvironmentConfig,
  resolveConfig,
  formatSchedule,
} from "./config.js";
import { AGENT_OPTIONS, formatAgentList } from "./agents.js";
import { UsageCollector } from "./collector.js";
import { acquireLock } from "./runtime-state.js";

export class InteractiveConfig {
  private readonly configManager = new ConfigManager();

  async runConfigurationWizard(): Promise<void> {
    console.log("\n🔧 ccusage-collector Configuration Wizard");
    const settings = this.configManager.readFileConfig();
    const existing = resolveConfig(settings);
    const environment = readEnvironmentConfig();

    if (existing) {
      const { shouldReconfigure } = await inquirer.prompt({
        type: "confirm",
        name: "shouldReconfigure",
        message: "Do you want to reconfigure?",
        default: false,
      });
      if (!shouldReconfigure) {
        console.log("Configuration unchanged.");
        return;
      }
    }

    const answers = await inquirer.prompt([
      {
        type: "checkbox",
        name: "agentTypes",
        message: "Select the coding agents to track:",
        when: !environment.agentTypes,
        choices: AGENT_OPTIONS.map((option) => ({
          name: option.label,
          value: option.value,
          checked: (existing?.agentTypes ?? CONFIG_DEFAULTS.agentTypes).some(
            (agent) => agent === option.value,
          ),
        })),
        validate: (input: readonly unknown[]) =>
          input.length > 0 || "Please select at least one agent",
      },
      {
        type: "password",
        name: "apiKey",
        message: "Enter your API Key:",
        mask: "*",
        default: existing?.apiKey,
        when: !environment.apiKey,
        validate: (input: string) =>
          Boolean(input.trim()) || "API Key is required",
      },
      {
        type: "input",
        name: "endpoint",
        message: "Enter the sync endpoint URL (including /api/usage-sync):",
        default: existing?.endpoint ?? "https://your-app.com/api/usage-sync",
        when: !environment.endpoint,
        validate: (input: string) => {
          try {
            const url = new URL(input);
            return (
              ["http:", "https:"].includes(url.protocol) || "Use an HTTP(S) URL"
            );
          } catch {
            return "Enter a valid HTTP(S) URL";
          }
        },
      },
      {
        type: "input",
        name: "displayName",
        message: "Enter a device display name (optional):",
        default: existing?.displayName ?? "",
        when: !environment.displayName,
      },
      {
        type: "list",
        name: "schedule",
        message: "Select sync frequency:",
        choices: SCHEDULE_OPTIONS.map(({ label, value }) => ({
          name: label,
          value,
        })),
        default: existing?.schedule ?? CONFIG_DEFAULTS.schedule,
      },
    ]);

    const config = resolveConfig({ ...settings, ...existing, ...answers });
    if (!config) throw new Error("API key and endpoint are required");
    console.log("\n🧪 Testing data collection...");
    const release = await acquireLock("sync");
    let collectionError: string | undefined;
    try {
      collectionError = await this.testCollection(config);
    } finally {
      await release();
    }
    if (collectionError) {
      console.log("❌ Data collection failed:", collectionError);
      const { shouldSaveAnyway } = await inquirer.prompt({
        type: "confirm",
        name: "shouldSaveAnyway",
        message: "Save configuration anyway?",
        default: false,
      });
      if (!shouldSaveAnyway) {
        console.log("Configuration cancelled.");
        return;
      }
    }

    this.configManager.saveConfig(config);
    console.log("✅ Configuration saved successfully!");
    console.log(`   Agents: ${formatAgentList(config.agentTypes)}`);
    console.log(`   API Endpoint: ${config.endpoint}`);
    console.log(`   Sync Schedule: ${formatSchedule(config.schedule)}`);
    console.log(`   Config saved to: ${this.configManager.getConfigPath()}`);
    console.log("\nRun once: ccusage-collector sync");
    console.log("Install/update background sync: ccusage-collector service install");
  }

  private async testCollection(config: Config): Promise<string | undefined> {
    const data = await new UsageCollector(config).collectAllUsageData();
    const missingAgents = config.agentTypes.filter(
      (agent) => !data.some(({ device }) => device.agentType === agent),
    );
    if (missingAgents.length > 0) {
      return `No usage data collected for: ${missingAgents.join(", ")}. Check the tools and data sources.`;
    }
    return undefined;
  }
}
