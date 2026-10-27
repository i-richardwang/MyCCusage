import { execFile } from "child_process";
import { promisify } from "util";
import axios from "axios";
import type {
  UsageData,
  DeviceInfo,
  SyncResult,
  CollectorConfig,
  AgentType,
  DailyUsageRecord,
  ModelBreakdown,
} from "./types.js";
import { collectAmpUsage } from "./amp/index.js";
import { collectDimagentUsage } from "./dimagent.js";
import { collectCursorUsage } from "./cursor.js";

const execFileAsync = promisify(execFile);

// An interactive shell supports the user's configured agent aliases.
async function execInShell(
  command: string,
): Promise<{ stdout: string; stderr: string }> {
  const shell = process.env.SHELL || "/bin/bash";
  return execFileAsync(shell, ["-ic", command]);
}

// Extract JSON from stdout (interactive shells may prepend noise from rc files)
export function extractJSON(stdout: string): string {
  const start = stdout.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in output");
  // Find the matching closing brace
  let depth = 0;
  for (let i = start; i < stdout.length; i++) {
    if (stdout[i] === "{") depth++;
    else if (stdout[i] === "}") depth--;
    if (depth === 0) return stdout.slice(start, i + 1);
  }
  throw new Error("Malformed JSON in output");
}

// Agents served by the ccusage CLI. AMP, DimAgent and Cursor are collected
// from their own sources instead (see collectFromSource) and never reach
// resolveCommand.
type CcusageAgentType = Exclude<AgentType, "amp" | "dimagent" | "cursor">;

// Domain agent identifiers mapped to ccusage subcommands.
const AGENT_CLI: Record<CcusageAgentType, { subcommand: string }> = {
  "claude-code": { subcommand: "claude" },
  opencode: { subcommand: "opencode" },
  codex: { subcommand: "codex" },
  antigravity: { subcommand: "antigravity" },
};

// Check if a command (or alias) exists in the user's shell
async function commandExists(bin: string): Promise<boolean> {
  try {
    await execInShell(`command -v ${bin}`);
    return true;
  } catch {
    return false;
  }
}

// Resolve the command to run: prefer local command/alias, fallback to bunx
// (then npx when bun is not installed).
// The unified Rust CLI replaced standalone wrappers such as ccusage-codex.
async function resolveCommand(agentType: CcusageAgentType): Promise<string> {
  const { subcommand } = AGENT_CLI[agentType];
  if (await commandExists("ccusage")) {
    return `ccusage ${subcommand} daily --json`;
  }
  if (await commandExists("bunx")) {
    console.warn(
      "ccusage command not found in PATH; falling back to bunx ccusage. " +
        "If you rely on a local ccusage fork, install it first so the collector uses that binary.",
    );
    return `bunx ccusage ${subcommand} daily --json`;
  }
  console.warn(
    "ccusage command not found in PATH and bunx is unavailable; falling back to npx ccusage. " +
      "If you rely on a local ccusage fork, install it first so the collector uses that binary.",
  );
  return `npx ccusage ${subcommand} daily --json`;
}

function numberField(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringArrayField(
  record: Record<string, unknown>,
  field: string,
): string[] {
  const value = record[field];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function getDailyRecordDate(record: Record<string, unknown>): string {
  if (typeof record.date === "string" && record.date.length > 0) {
    return record.date;
  }

  if (typeof record.period === "string" || typeof record.agent === "string") {
    throw new Error(
      "Received all-agent ccusage output; collector must call an explicit agent subcommand",
    );
  }

  throw new Error("Missing daily record date");
}

// Extract modelsUsed and modelBreakdowns from codex-style models object
// Codex outputs: { models: { "gpt-5.2": { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens, isFallback }, ... } }
function extractModelsFromObject(
  models: Record<string, Record<string, unknown>>,
): {
  modelsUsed: string[];
  modelBreakdowns: ModelBreakdown[];
} {
  const modelsUsed = Object.keys(models);
  const modelBreakdowns = modelsUsed.map((modelName) => {
    const m = models[modelName] ?? {};
    return {
      modelName,
      inputTokens: (m.inputTokens as number) || 0,
      outputTokens: (m.outputTokens as number) || 0,
      cacheCreationTokens: 0,
      // Codex uses cachedInputTokens for cache read tokens
      cacheReadTokens: (m.cachedInputTokens as number) || 0,
      cost: 0,
    };
  });
  return { modelsUsed, modelBreakdowns };
}

// Map ccusage output fields to API expected fields
export function mapCcusageRecord(
  record: Record<string, unknown>,
): DailyUsageRecord {
  // Extract models info: codex uses a models object, others use modelsUsed array + modelBreakdowns array
  let modelsUsed = stringArrayField(record, "modelsUsed");
  let modelBreakdowns = (record.modelBreakdowns as ModelBreakdown[]) || [];

  if (
    modelsUsed.length === 0 &&
    record.models &&
    typeof record.models === "object" &&
    !Array.isArray(record.models)
  ) {
    const extracted = extractModelsFromObject(
      record.models as Record<string, Record<string, unknown>>,
    );
    modelsUsed = extracted.modelsUsed;
    modelBreakdowns = extracted.modelBreakdowns;
  }

  return {
    date: getDailyRecordDate(record),
    inputTokens: numberField(record, "inputTokens"),
    outputTokens: numberField(record, "outputTokens"),
    // ccusage uses cacheCreationInputTokens, API expects cacheCreationTokens
    cacheCreationTokens:
      numberField(record, "cacheCreationInputTokens") ||
      numberField(record, "cacheCreationTokens") ||
      0,
    // ccusage uses cacheReadInputTokens, API expects cacheReadTokens
    // Codex uses cachedInputTokens for cache read tokens
    cacheReadTokens:
      numberField(record, "cacheReadInputTokens") ||
      numberField(record, "cacheReadTokens") ||
      numberField(record, "cachedInputTokens") ||
      0,
    totalTokens: numberField(record, "totalTokens"),
    // ccusage uses costUSD, API expects totalCost
    totalCost:
      numberField(record, "costUSD") || numberField(record, "totalCost"),
    modelsUsed,
    modelBreakdowns,
    rawData: record,
  };
}

type CollectedUsage = Pick<UsageData, "daily" | "totals">;

async function collectCcusage(
  agent: CcusageAgentType,
): Promise<CollectedUsage> {
  const command = await resolveCommand(agent);
  console.log(`Collecting ${agent} usage data via: ${command}`);
  const { stdout } = await execInShell(command);

  const rawData = JSON.parse(extractJSON(stdout));

  if (!rawData.daily || !Array.isArray(rawData.daily)) {
    throw new Error("Invalid usage data format");
  }

  return {
    // Map ccusage output fields to API expected fields
    daily: rawData.daily.map((record: Record<string, unknown>) =>
      mapCcusageRecord(record),
    ),
    totals: rawData.totals,
  };
}

// DimAgent's local SQLite store; the parser emits ccusage-shaped records.
function collectDimagent(): CollectedUsage {
  console.log("Collecting dimagent usage data from local SQLite store");
  const { daily, totals } = collectDimagentUsage();
  return {
    daily: daily.map((record) =>
      mapCcusageRecord(record as unknown as Record<string, unknown>),
    ),
    totals,
  };
}

// Cursor's cloud export; the parser emits ccusage-shaped records. Skipped
// runs surface their warnings and sync nothing; dead credentials throw.
async function collectCursor(): Promise<CollectedUsage> {
  console.log("Collecting cursor usage data from cloud export");
  const { daily, totals, warnings } = await collectCursorUsage();
  for (const warning of warnings) {
    console.warn(warning);
  }
  return {
    daily: daily.map((record) =>
      mapCcusageRecord(record as unknown as Record<string, unknown>),
    ),
    totals,
  };
}

async function collectFromSource(agent: AgentType): Promise<CollectedUsage> {
  switch (agent) {
    // AMP threads live server-side; they are read through the `amp` CLI
    case "amp":
      return collectAmpUsage();
    case "dimagent":
      return collectDimagent();
    case "cursor":
      return collectCursor();
    default:
      return collectCcusage(agent);
  }
}

export class UsageCollector {
  private readonly config: CollectorConfig;

  constructor(config: CollectorConfig) {
    this.config = { ...config, agentTypes: [...config.agentTypes] };
  }

  async collectUsageData(agent: AgentType): Promise<UsageData> {
    try {
      const { daily, totals } = await collectFromSource(agent);

      // Copy the resolved identity so each agent keeps its own metadata.
      const deviceInfo: DeviceInfo = {
        deviceId: this.config.deviceId,
        deviceName: this.config.deviceName,
        displayName: this.config.displayName,
        agentType: agent,
      };

      const displayName = deviceInfo.displayName || deviceInfo.deviceName;
      console.log(`Device: ${displayName} (${deviceInfo.deviceId})`);
      console.log(`Agent Type: ${agent}`);

      const data: UsageData = {
        device: deviceInfo,
        daily,
        totals,
      };

      console.log(`Collected ${data.daily.length} daily records`);
      return data;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(
          `Failed to collect ${agent} usage data: ${error.message}`,
        );
      }
      throw new Error(`Failed to collect ${agent} usage data: Unknown error`);
    }
  }

  // Collect usage data for all configured agent types
  async collectAllUsageData(): Promise<UsageData[]> {
    const agentTypes = this.config.agentTypes;
    const results: UsageData[] = [];

    for (const agentType of agentTypes) {
      try {
        const data = await this.collectUsageData(agentType);
        results.push(data);
      } catch (error) {
        console.error(
          `Failed to collect ${agentType} data:`,
          error instanceof Error ? error.message : error,
        );
        // Continue with other agents even if one fails
      }
    }

    return results;
  }

  async syncData(data: UsageData): Promise<SyncResult> {
    const { endpoint, apiKey, maxRetries, retryDelay } = this.config;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `Syncing ${data.device.agentType} data (attempt ${attempt}/${maxRetries})...`,
        );

        const response = await axios.post(endpoint, data, {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          timeout: 30000,
        });

        const result: SyncResult = response.data;

        if (result.success) {
          console.log(`Successfully synced ${result.processed} records`);

          // Log any errors for individual records
          const errors = result.results.filter((r) => r.status === "error");
          if (errors.length > 0) {
            console.warn(`${errors.length} records had errors:`);
            errors.forEach((error) => {
              console.warn(`  - ${error.date}: ${error.message}`);
            });
          }

          return result;
        } else {
          throw new Error("Sync failed: " + JSON.stringify(result));
        }
      } catch (error) {
        const isLastAttempt = attempt === maxRetries;

        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          const message = error.response?.data?.error || error.message;

          console.error(
            `Sync failed (attempt ${attempt}/${maxRetries}): ${status} - ${message}`,
          );

          // Don't retry on authentication errors
          if (status === 401 || status === 403) {
            throw new Error(`Authentication failed: ${message}`);
          }

          if (isLastAttempt) {
            throw new Error(
              `Sync failed after ${maxRetries} attempts: ${message}`,
            );
          }
        } else {
          console.error(
            `Sync failed (attempt ${attempt}/${maxRetries}):`,
            error,
          );

          if (isLastAttempt) {
            throw error;
          }
        }

        // Wait before retrying
        if (!isLastAttempt) {
          console.log(`Retrying in ${retryDelay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      }
    }

    throw new Error("Sync failed after all retries");
  }

  async run(): Promise<{ failedAgents: AgentType[] }> {
    const agentTypes = this.config.agentTypes;
    let successCount = 0;
    const failedAgents: AgentType[] = [];

    for (const agentType of agentTypes) {
      try {
        console.log(`\n--- ${agentType} ---`);
        const data = await this.collectUsageData(agentType);
        await this.syncData(data);
        console.log(`${agentType} sync completed successfully`);
        successCount++;
      } catch (error) {
        failedAgents.push(agentType);
        console.error(
          `${agentType} sync failed:`,
          error instanceof Error ? error.message : error,
        );
        // Continue with other agents
      }
    }

    // Let the caller decide how to report or recover from a failed run.
    if (successCount === 0) {
      throw new Error("No agents synced successfully");
    }
    return { failedAgents };
  }
}
