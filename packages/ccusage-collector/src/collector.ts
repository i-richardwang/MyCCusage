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
  UsageBucket,
} from "./types.js";
import { createCalendar, isTimeZone, type Calendar } from "./calendar.js";
import { collectAmpUsage } from "./amp/index.js";
import { collectDimagentUsage } from "./dimagent.js";
import { collectCursorUsage } from "./cursor.js";
import { dailyBuckets } from "./buckets.js";
import { loadPricing } from "./pricing/index.js";
import type { PricingTable } from "./pricing/rates.js";
import {
  collectTranscriptUsage,
  type TranscriptAgent,
} from "./transcripts/index.js";

// Version of the upload format. The dashboard reports the one it accepts, and
// the collector uploads only to a dashboard that speaks its own.
export const SYNC_PROTOCOL = 2;

const execFileAsync = promisify(execFile);

// An interactive shell supports the user's configured agent aliases.
async function execInShell(
  command: string,
  env?: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  const shell = process.env.SHELL || "/bin/bash";
  return execFileAsync(shell, ["-ic", command], { env });
}

const TIMEZONE_HANDOFF = "MYCCUSAGE_RESOLVED_TIMEZONE";

// The account time zone of one ccusage call travels through a private
// variable expanded on the command line, after rc files have loaded, so
// neither shell profiles nor quoting can alter it.
export function scopeCcusageCommand(
  command: string,
  timeZone: string,
): { command: string; env: NodeJS.ProcessEnv } {
  return {
    command: `${command} --timezone "$${TIMEZONE_HANDOFF}"`,
    env: { ...process.env, [TIMEZONE_HANDOFF]: timeZone },
  };
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

// Agents served by the ccusage CLI. The others are read from their own
// sources (see collectFromSource) and never reach resolveCommand.
type CcusageAgentType = "opencode" | "antigravity";

// Domain agent identifiers mapped to ccusage subcommands.
const AGENT_CLI: Record<CcusageAgentType, { subcommand: string }> = {
  opencode: { subcommand: "opencode" },
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

// A day of ccusage output, whose field names vary by agent
export function mapCcusageRecord(
  record: Record<string, unknown>,
): DailyUsageRecord {
  const modelBreakdowns = Array.isArray(record.modelBreakdowns)
    ? (record.modelBreakdowns as ModelBreakdown[])
    : [];

  return {
    date: getDailyRecordDate(record),
    inputTokens: numberField(record, "inputTokens"),
    outputTokens: numberField(record, "outputTokens"),
    cacheCreationTokens:
      numberField(record, "cacheCreationInputTokens") ||
      numberField(record, "cacheCreationTokens") ||
      0,
    cacheReadTokens:
      numberField(record, "cacheReadInputTokens") ||
      numberField(record, "cacheReadTokens") ||
      0,
    totalCost:
      numberField(record, "costUSD") || numberField(record, "totalCost"),
    modelBreakdowns,
  };
}

async function collectCcusage(
  agent: CcusageAgentType,
  calendar: Calendar,
): Promise<DailyUsageRecord[]> {
  const { command, env } = scopeCcusageCommand(
    await resolveCommand(agent),
    calendar.timeZone,
  );
  console.log(`Collecting ${agent} usage data via: ${command}`);
  const { stdout } = await execInShell(command, env);

  const output = JSON.parse(extractJSON(stdout));
  if (!Array.isArray(output.daily)) {
    throw new Error("Invalid usage data format");
  }
  return output.daily.map((record: Record<string, unknown>) =>
    mapCcusageRecord(record),
  );
}

// Cursor's cloud export. Skipped runs surface their warnings and sync
// nothing; dead credentials throw.
async function collectCursor(calendar: Calendar): Promise<UsageBucket[]> {
  console.log("Collecting cursor usage data from cloud export");
  const { buckets, warnings } = await collectCursorUsage(calendar);
  for (const warning of warnings) {
    console.warn(warning);
  }
  return buckets;
}

// Claude Code and Codex transcripts: the recent days, hour by hour
async function collectTranscripts(
  agent: TranscriptAgent,
  config: CollectorConfig,
  calendar: Calendar,
  pricing: PricingTable,
  fullHistory: boolean,
): Promise<CollectedUsage> {
  const { range, buckets, backfillBefore, unpricedModels, malformedRecords } =
    await collectTranscriptUsage(agent, calendar, pricing, {
      claudeConfigDirs: config.claudeConfigDirs,
      fullHistory,
    });
  console.log(
    fullHistory
      ? `Read all available ${agent} history; preserve existing days before ${backfillBefore}`
      : range
        ? `Read ${agent} usage from ${range.from} to ${range.to}`
        : `No recent ${agent} usage found`,
  );
  if (unpricedModels.length > 0) {
    console.warn(
      `No prices for ${unpricedModels.join(", ")}; their usage counts at zero cost.`,
    );
  }
  if (malformedRecords > 0) {
    console.warn(
      `Skipped ${malformedRecords} inconsistent ${agent} usage records.`,
    );
  }
  return { range, buckets, backfillBefore };
}

type CollectedUsage = Pick<UsageData, "buckets" | "range" | "backfillBefore">;

// Sources that record each request's time report hours; AMP and ccusage
// report whole days.
async function collectFromSource(
  agent: AgentType,
  config: CollectorConfig,
  calendar: Calendar,
  pricing: () => Promise<PricingTable>,
  fullHistory: boolean,
): Promise<CollectedUsage> {
  switch (agent) {
    case "claude-code":
    case "codex":
      return collectTranscripts(
        agent,
        config,
        calendar,
        await pricing(),
        fullHistory,
      );
    case "dimagent":
      console.log("Collecting dimagent usage data from local SQLite store");
      return { buckets: collectDimagentUsage(calendar) };
    case "cursor":
      return { buckets: await collectCursor(calendar) };
    // AMP threads live server-side; they are read through the `amp` CLI
    case "amp":
      return {
        buckets: dailyBuckets(await collectAmpUsage(calendar, pricing)),
      };
    default:
      return { buckets: dailyBuckets(await collectCcusage(agent, calendar)) };
  }
}

export class UsageCollector {
  private readonly config: CollectorConfig;
  private pricing?: Promise<PricingTable>;

  // Loaded once per collector, on first use
  private readonly loadPricing = () => (this.pricing ??= loadPricing());

  constructor(
    config: CollectorConfig,
    private readonly options: { fullHistory?: boolean } = {},
  ) {
    this.config = {
      ...config,
      agentTypes: [...config.agentTypes],
      claudeConfigDirs: config.claudeConfigDirs && [...config.claudeConfigDirs],
    };
  }

  // The dashboard owns the account time zone; every run buckets days and
  // hours in it
  async fetchCalendar(): Promise<Calendar> {
    const { endpoint, apiKey } = this.config;
    let timeZone: unknown;
    let protocol: unknown;
    let historyBackfill: unknown;
    try {
      const response = await axios.get(endpoint, {
        headers: { "x-api-key": apiKey },
        timeout: 30000,
      });
      timeZone = response.data?.timezone;
      protocol = response.data?.protocol;
      historyBackfill = response.data?.historyBackfill;
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? error.response?.data?.error || error.message
        : String(error);
      throw new Error(`Could not read the account time zone: ${message}`);
    }
    if (protocol !== SYNC_PROTOCOL) {
      throw new Error(
        `The dashboard speaks sync protocol ${String(protocol ?? "none")}, this collector ${SYNC_PROTOCOL}; update the older of the two`,
      );
    }
    if (this.options.fullHistory && historyBackfill !== true) {
      throw new Error(
        "Update the dashboard before using --full-history; it must support safe history backfill",
      );
    }
    if (typeof timeZone !== "string" || !isTimeZone(timeZone)) {
      throw new Error(`Invalid account time zone: ${String(timeZone)}`);
    }
    console.log(`Account time zone: ${timeZone}`);
    return createCalendar(timeZone);
  }

  async collectUsageData(
    agent: AgentType,
    calendar: Calendar,
  ): Promise<UsageData> {
    try {
      const { buckets, range, backfillBefore } = await collectFromSource(
        agent,
        this.config,
        calendar,
        this.loadPricing,
        this.options.fullHistory === true,
      );

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
        timezone: calendar.timeZone,
        ...(range ? { range } : {}),
        ...(backfillBefore ? { backfillBefore } : {}),
        buckets,
      };

      console.log(`Collected ${data.buckets.length} usage buckets`);
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
    const calendar = await this.fetchCalendar();
    const results: UsageData[] = [];

    for (const agentType of agentTypes) {
      try {
        const data = await this.collectUsageData(agentType, calendar);
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

        const response = await axios.post(
          endpoint,
          { version: SYNC_PROTOCOL, ...data },
          {
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
            },
            timeout: 30000,
          },
        );

        const result: SyncResult = response.data;

        if (result.success) {
          console.log(
            `Synced ${result.buckets} usage buckets over ${result.days.length} day(s)`,
          );
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
    const calendar = await this.fetchCalendar();
    let successCount = 0;
    const failedAgents: AgentType[] = [];

    for (const agentType of agentTypes) {
      try {
        console.log(`\n--- ${agentType} ---`);
        const data = await this.collectUsageData(agentType, calendar);
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
