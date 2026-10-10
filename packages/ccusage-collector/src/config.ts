import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import type { AgentType } from "./types.js";

export interface Config {
  apiKey: string;
  endpoint: string;
  schedule: string;
  scheduleLabel: string;
  maxRetries: number;
  retryDelay: number;
  deviceId?: string;
  deviceName?: string;
  displayName?: string;
  agentTypes?: AgentType[];
}

export const AGENT_OPTIONS = [
  { value: "claude-code" as const, label: "Claude Code", package: "ccusage" },
  { value: "amp" as const, label: "AMP", package: "ccusage" },
  {
    value: "opencode" as const,
    label: "OpenCode",
    package: "ccusage",
  },
  { value: "codex" as const, label: "Codex", package: "ccusage" },
  { value: "dimagent" as const, label: "DimAgent", package: "dimcode" },
  {
    value: "cursor" as const,
    label: "Cursor",
    package: "cursor",
  },
  {
    value: "antigravity" as const,
    label: "Antigravity",
    package: "ccusage",
  },
];

export const SCHEDULE_OPTIONS = [
  { value: "*/30 * * * *", label: "Every 30 minutes" },
  { value: "0 * * * *", label: "Every 1 hour" },
  { value: "0 */2 * * *", label: "Every 2 hours" },
  { value: "0 */4 * * *", label: "Every 4 hours" },
  { value: "0 */8 * * *", label: "Every 8 hours" },
  { value: "0 0 * * *", label: "Once daily" },
];

/**
 * Read a MYCCUSAGE_* environment override.
 *
 * Blank values count as unset so an empty export can never shadow a valid
 * file entry. Raw access stays in this one place; callers use the helpers
 * below instead of touching process.env directly.
 */
function envOverride(name: "MYCCUSAGE_API_KEY" | "MYCCUSAGE_ENDPOINT"):
  | string
  | undefined {
  // Dynamic access on purpose: a single choke point instead of one
  // process.env.LITERAL per variable (runtime-only lookup, not a build input).
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export interface EnvOverrideStatus {
  apiKeyFromEnv: boolean;
  endpointFromEnv: boolean;
}

/** Read back a credential override for callers that skipped prompting. */
export function getEnvOverride(
  name: "MYCCUSAGE_API_KEY" | "MYCCUSAGE_ENDPOINT",
): string | undefined {
  return envOverride(name);
}

export class ConfigManager {
  private configDir: string;
  private configPath: string;

  constructor() {
    this.configDir = join(homedir(), ".ccusage-collector");
    this.configPath = join(this.configDir, "config.json");
  }

  /** Which credential fields are currently supplied via environment. */
  getEnvOverrideStatus(): EnvOverrideStatus {
    return {
      apiKeyFromEnv: envOverride("MYCCUSAGE_API_KEY") !== undefined,
      endpointFromEnv: envOverride("MYCCUSAGE_ENDPOINT") !== undefined,
    };
  }

  /** Read and parse the config file; null when absent or unreadable. */
  private loadFileConfig(): Record<string, unknown> | null {
    try {
      if (!this.hasConfig()) return null;
      return JSON.parse(readFileSync(this.configPath, "utf8"));
    } catch (error) {
      console.error("Failed to load config:", error);
      return null;
    }
  }

  hasConfig(): boolean {
    return existsSync(this.configPath);
  }

  loadConfig(): Config | null {
    const fileConfig = this.loadFileConfig();

    // Deployment credentials: environment wins over the file, and env
    // values are never written back to disk (see saveConfig).
    const apiKey =
      envOverride("MYCCUSAGE_API_KEY") ??
      (typeof fileConfig?.apiKey === "string" ? fileConfig.apiKey : undefined);
    const endpoint =
      envOverride("MYCCUSAGE_ENDPOINT") ??
      (typeof fileConfig?.endpoint === "string"
        ? fileConfig.endpoint
        : undefined);

    // Validate required fields
    if (!apiKey || !endpoint) {
      return null;
    }

    const agentTypes = Array.isArray(fileConfig?.agentTypes)
      ? (fileConfig.agentTypes as AgentType[])
      : typeof fileConfig?.agentType === "string"
        ? [fileConfig.agentType as AgentType]
        : ["claude-code" as AgentType];

    return {
      apiKey,
      endpoint,
      schedule:
        typeof fileConfig?.schedule === "string"
          ? fileConfig.schedule
          : "0 */4 * * *",
      scheduleLabel:
        typeof fileConfig?.scheduleLabel === "string"
          ? fileConfig.scheduleLabel
          : "Every 4 hours",
      maxRetries:
        typeof fileConfig?.maxRetries === "number" ? fileConfig.maxRetries : 3,
      retryDelay:
        typeof fileConfig?.retryDelay === "number" ? fileConfig.retryDelay : 1000,
      deviceId:
        typeof fileConfig?.deviceId === "string" ? fileConfig.deviceId : undefined,
      deviceName:
        typeof fileConfig?.deviceName === "string"
          ? fileConfig.deviceName
          : undefined,
      displayName:
        typeof fileConfig?.displayName === "string"
          ? fileConfig.displayName
          : undefined,
      // Migrate legacy single agentType to agentTypes array
      agentTypes,
    };
  }

  saveConfig(config: Config): void {
    try {
      // Ensure config directory exists
      if (!existsSync(this.configDir)) {
        mkdirSync(this.configDir, { recursive: true });
      }

      // Environment-supplied credentials must never land on disk: strip
      // them so a load -> save round-trip (e.g. updateDeviceInfo) cannot
      // persist secrets that came from MYCCUSAGE_* variables.
      const { apiKey, endpoint, ...fileFields } = config;
      const toPersist: Record<string, unknown> = { ...fileFields };
      if (envOverride("MYCCUSAGE_API_KEY") === undefined) {
        toPersist.apiKey = apiKey;
      }
      if (envOverride("MYCCUSAGE_ENDPOINT") === undefined) {
        toPersist.endpoint = endpoint;
      }

      // Write config file
      writeFileSync(this.configPath, JSON.stringify(toPersist, null, 2));

      // Set file permissions to 600 (user read/write only)
      chmodSync(this.configPath, 0o600);

      console.log("✅ Configuration saved successfully!");
    } catch (error) {
      console.error("Failed to save config:", error);
      throw error;
    }
  }

  getConfigPath(): string {
    return this.configPath;
  }

  updateDeviceInfo(deviceId: string, deviceName: string): void {
    try {
      const config = this.loadConfig();
      if (!config) {
        throw new Error("No configuration found");
      }

      const updatedConfig = {
        ...config,
        deviceId,
        deviceName,
      };

      this.saveConfig(updatedConfig);
    } catch (error) {
      console.error("Failed to update device info:", error);
      throw error;
    }
  }

  showNoConfigMessage(): void {
    console.log(`
❌ Configuration not found!

📋 Please run the following command to configure first:
   ccusage-collector config

💡 Then start with PM2:
   pm2 start ccusage-collector -- start
`);
  }
}
