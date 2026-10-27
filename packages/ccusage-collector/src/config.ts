import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import type { AgentType, CollectorConfig } from "./types.js";
import { resolveDeviceIdentity } from "./utils/device-info.js";
import { AGENT_OPTIONS } from "./agents.js";
import { parseSchedule } from "./schedule.js";

export interface Config extends CollectorConfig {
  schedule: string;
}

export const SCHEDULE_OPTIONS = [
  { value: "*/30 * * * *", label: "Every 30 minutes" },
  { value: "0 * * * *", label: "Every 1 hour" },
  { value: "0 */2 * * *", label: "Every 2 hours" },
  { value: "0 */4 * * *", label: "Every 4 hours" },
  { value: "0 */8 * * *", label: "Every 8 hours" },
  { value: "0 0 * * *", label: "Once daily" },
];

export const CONFIG_DEFAULTS = {
  agentTypes: ["claude-code"],
  schedule: "0 */4 * * *",
  maxRetries: 3,
  retryDelay: 1000,
} as const;

/** One mapping for runtime overrides and persistence exclusions. */
export const CONFIG_ENV_VARS = {
  apiKey: "MYCCUSAGE_API_KEY",
  endpoint: "MYCCUSAGE_ENDPOINT",
  agentTypes: "MYCCUSAGE_AGENT_TYPES",
  deviceId: "MYCCUSAGE_DEVICE_ID",
  deviceName: "MYCCUSAGE_DEVICE_NAME",
  displayName: "MYCCUSAGE_DISPLAY_NAME",
} as const;

type EnvironmentConfig = Partial<Record<keyof typeof CONFIG_ENV_VARS, string>>;

export function readEnvironmentConfig(
  env: NodeJS.ProcessEnv = process.env,
): EnvironmentConfig {
  const config: EnvironmentConfig = {};
  for (const [field, name] of Object.entries(CONFIG_ENV_VARS)) {
    const value = env[name]?.trim();
    if (value) config[field as keyof EnvironmentConfig] = value;
  }
  return config;
}

export function formatSchedule(schedule: string): string {
  return (
    SCHEDULE_OPTIONS.find(({ value }) => value === schedule)?.label ?? schedule
  );
}

function stringSetting(value: unknown, source: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${source} must be a string`);
  }
  return value.trim() || undefined;
}

function parseAgentTypes(value: unknown, source: string): AgentType[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${source} must contain at least one supported agent`);
  }
  const agents: AgentType[] = [];
  for (const item of value) {
    const option = AGENT_OPTIONS.find(
      ({ value }) => typeof item === "string" && value === item.trim(),
    );
    if (!option) {
      // Do not echo arbitrary input: a misplaced secret must stay out of logs.
      throw new Error(
        `${source} must contain only supported agents: ${AGENT_OPTIONS.map(({ value }) => value).join(", ")}`,
      );
    }
    if (!agents.includes(option.value)) agents.push(option.value);
  }
  return agents;
}

function numberSetting(
  value: unknown,
  fallback: number,
  minimum: number,
  source: string,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new Error(`${source} must be an integer >= ${minimum}`);
  }
  return value;
}

/** Resolve once at the boundary; collection never reads configuration sources. */
export function resolveConfig(
  config: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Config | null {
  const environment = readEnvironmentConfig(env);
  const fields = new Set([
    ...Object.keys(CONFIG_ENV_VARS),
    "schedule",
    "maxRetries",
    "retryDelay",
  ]);
  if (Object.keys(config).some((field) => !fields.has(field))) {
    throw new Error(
      `Config supports only these fields: ${[...fields].join(", ")}`,
    );
  }
  function setting(field: Exclude<keyof typeof CONFIG_ENV_VARS, "agentTypes">) {
    return (
      environment[field] ?? stringSetting(config[field], `${field} in config`)
    );
  }

  const apiKey = setting("apiKey");
  const endpoint = setting("endpoint");
  if (!apiKey || !endpoint) return null;

  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new Error();
  } catch {
    const source = environment.endpoint
      ? CONFIG_ENV_VARS.endpoint
      : "endpoint in config";
    throw new Error(`${source} must be an absolute HTTP(S) URL`);
  }

  const envAgents = environment.agentTypes;
  const agentTypes =
    envAgents !== undefined
      ? parseAgentTypes(envAgents.split(","), CONFIG_ENV_VARS.agentTypes)
      : parseAgentTypes(
          config.agentTypes === undefined
            ? CONFIG_DEFAULTS.agentTypes
            : config.agentTypes,
          "agentTypes in config",
        );
  const schedule =
    stringSetting(config.schedule, "schedule in config") ??
    CONFIG_DEFAULTS.schedule;
  parseSchedule(schedule);

  return {
    apiKey,
    endpoint,
    agentTypes,
    schedule,
    maxRetries: numberSetting(
      config.maxRetries,
      CONFIG_DEFAULTS.maxRetries,
      1,
      "maxRetries in config",
    ),
    retryDelay: numberSetting(
      config.retryDelay,
      CONFIG_DEFAULTS.retryDelay,
      0,
      "retryDelay in config",
    ),
    ...resolveDeviceIdentity({
      deviceId: setting("deviceId"),
      deviceName: setting("deviceName"),
      displayName: setting("displayName"),
    }),
  };
}

export class ConfigManager {
  private readonly configDir: string;
  private readonly configPath: string;

  constructor() {
    this.configDir = join(homedir(), ".ccusage-collector");
    this.configPath = join(this.configDir, "config.json");
  }

  readFileConfig(): Record<string, unknown> {
    if (!this.hasConfig()) return {};
    let config: unknown;
    try {
      config = JSON.parse(readFileSync(this.configPath, "utf8"));
    } catch {
      // JSON parser errors can contain fragments of credentials.
      throw new Error(`Unable to read valid JSON config at ${this.configPath}`);
    }
    if (
      config === null ||
      typeof config !== "object" ||
      Array.isArray(config)
    ) {
      throw new Error(
        `Config at ${this.configPath} must contain a JSON object`,
      );
    }
    return config as Record<string, unknown>;
  }

  hasConfig(): boolean {
    return existsSync(this.configPath);
  }

  loadConfig(): Config | null {
    return resolveConfig(this.readFileConfig());
  }

  /** Explicit persistence only: sync/test/status never call this. */
  saveConfig(config: Config): void {
    const fileConfig = this.readFileConfig();
    const toPersist: Record<string, unknown> = { ...config };
    const environment = readEnvironmentConfig();
    for (const field of Object.keys(environment)) {
      if (Object.hasOwn(fileConfig, field))
        toPersist[field] = fileConfig[field];
      else delete toPersist[field];
    }
    mkdirSync(this.configDir, { recursive: true });
    writeFileSync(this.configPath, JSON.stringify(toPersist, null, 2), {
      mode: 0o600,
    });
    chmodSync(this.configPath, 0o600);
  }

  getConfigPath(): string {
    return this.configPath;
  }
}

/** Required configuration for command-line and scheduled collection. */
export function requireConfig(): Config {
  const config = new ConfigManager().loadConfig();
  if (!config) {
    throw new Error(
      "Set MYCCUSAGE_API_KEY and MYCCUSAGE_ENDPOINT in the environment, or run ccusage-collector config.",
    );
  }
  return config;
}
