import { execFile } from "child_process";
import { promisify } from "util";
import type { Calendar } from "./calendar.js";
import type { DailyUsageRecord, ModelBreakdown } from "./types.js";

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
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < stdout.length; i++) {
    const char = stdout[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return stdout.slice(start, i + 1);
    }
  }
  throw new Error("Malformed JSON in output");
}

// Agents served by the ccusage CLI. The others are read from their own
// sources and never reach this adapter.
type CcusageAgentType = "opencode" | "antigravity";

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
async function resolveCommand(agentType: CcusageAgentType): Promise<string> {
  const subcommand = agentType;
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

export async function collectCcusage(
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
