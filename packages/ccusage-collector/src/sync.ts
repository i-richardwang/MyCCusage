import { UsageCollector } from "./collector.js";
import { requireConfig } from "./config.js";
import { formatAgentList } from "./agents.js";
import { acquireLock, trackSync, CollectorBusyError } from "./runtime-state.js";

interface SyncOptions {
  dryRun?: boolean;
  fullHistory?: boolean;
  scheduled?: boolean;
}

/** One collection workflow shared by interactive and OS-scheduled entry points. */
export async function runSync(options: SyncOptions = {}): Promise<void> {
  const config = requireConfig();
  let release: () => Promise<void>;
  try {
    release = await acquireLock("sync");
  } catch (error) {
    if (options.scheduled && error instanceof CollectorBusyError) {
      console.log(
        "A sync is already running; skipped this scheduled invocation.",
      );
      return;
    }
    throw error;
  }
  try {
    const collector = new UsageCollector(config, {
      fullHistory: options.fullHistory,
    });
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
    const result = await trackSync(() => collector.run(), config.apiKey);
    if (result.failedAgents.length)
      throw new Error(
        `Sync partially failed for: ${result.failedAgents.join(", ")}`,
      );
    console.log("✅ Sync completed successfully");
  } finally {
    await release();
  }
}
