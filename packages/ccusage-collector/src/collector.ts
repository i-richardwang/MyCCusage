import axios from "axios";
import type {
  UsageData,
  DeviceInfo,
  SyncResult,
  CollectorConfig,
  AgentType,
  UsageBucket,
} from "./types.js";
import { createCalendar, isTimeZone, type Calendar } from "./calendar.js";
import { collectAmpUsage } from "./amp/index.js";
import { collectDimagentUsage } from "./dimagent.js";
import { collectCursorUsage } from "./cursor.js";
import { collectCcusage } from "./ccusage.js";
import { dailyBuckets } from "./buckets.js";
import { loadPricing } from "./pricing/index.js";
import type { PricingTable } from "./pricing/rates.js";
import {
  collectTranscriptUsage,
  type TranscriptAgent,
} from "./transcripts/index.js";

// Version of the upload format. The dashboard reports the one it accepts, and
// the collector uploads only to a dashboard that speaks its own.
export const SYNC_PROTOCOL = 3;

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

// Claude Code and Codex requests, priced and bucketed by hour and model
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
    try {
      const response = await axios.get(endpoint, {
        headers: { "x-api-key": apiKey },
        timeout: 30000,
      });
      timeZone = response.data?.timezone;
      protocol = response.data?.protocol;
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
