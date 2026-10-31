import type { ModelBreakdown } from "../types.js";
import type { AmpUsageEntry } from "./threads.js";

// Thread exports only carry the main agent's usage (routing purpose
// "Agent"). Subagents and side calls — Task, Read Thread, View Media, Finder,
// Librarian, compaction, Thread Title — appear only in the server-rendered
// `amp threads usage --details` report, which has no JSON form. This module
// parses that report and merges it with the export's per-message usage.

export interface AmpReportModel {
  // Display name, e.g. "Opus 5.5"
  name: string;
  requests: number;
  // Uncached input + cache writes + cache reads
  inputTokens: number;
  outputTokens: number;
}

export interface AmpReportRoute {
  // Routing id, e.g. "anthropic/claude-opus-5-5"
  modelId: string;
  purpose: string;
  requests: number;
}

export interface AmpDayReport {
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  models: AmpReportModel[];
  routing: AmpReportRoute[];
}

// Usage Amp ran through an external agent (Claude Code on the user's own
// subscription). the Claude transcript source counts it under claude-code.
const EXTERNAL_AGENT_PREFIX = "external-agent:";

function parseCount(cell: string | undefined): number | null {
  if (cell === undefined) return null;
  const value = Number(cell.replace(/,/g, "").trim());
  return Number.isFinite(value) ? value : null;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

// Rows of the markdown table whose first header cell is `firstColumn`, keyed
// by header name so optional columns (e.g. "Est. list price") do not shift
// the data.
function readTable(
  lines: string[],
  firstColumn: string,
): Array<Record<string, string>> | null {
  const start = lines.findIndex(
    (line) => line.startsWith("|") && splitRow(line)[0] === firstColumn,
  );
  if (start === -1) return null;
  const header = splitRow(lines[start]!);
  const rows: Array<Record<string, string>> = [];
  // Skip the header and its `| --- |` separator
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    const cells = splitRow(line);
    rows.push(Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ""])));
  }
  return rows;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

// Parse one `amp threads usage --details` report. Returns an empty report for
// a range without usage, and throws when the text cannot be parsed or its
// tables do not add up to its totals.
export function parseThreadUsageReport(text: string): AmpDayReport {
  if (/^No usage recorded in the selected range\./m.test(text)) {
    return { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, models: [], routing: [] };
  }

  const input = text.match(/^Input tokens: ([\d,]+)(?: \(([\d,]+) cache reads\))?/m);
  const output = text.match(/^Output tokens: ([\d,]+)/m);
  if (!input || !output) {
    throw new Error("Amp usage report has no token totals");
  }

  const lines = text.split("\n").map((line) => line.trim());
  const modelRows = readTable(lines, "Model");
  const routeRows = readTable(lines, "Model ID");
  if (!modelRows || !routeRows) {
    throw new Error("Amp usage report is missing the Models or Model Routing table");
  }

  const models = modelRows.map((row) => {
    const requests = parseCount(row.Requests);
    const inputTokens = parseCount(row.Input);
    const outputTokens = parseCount(row.Output);
    if (!row.Model || requests === null || inputTokens === null || outputTokens === null) {
      throw new Error(`Unrecognized Amp usage model row: ${JSON.stringify(row)}`);
    }
    return { name: row.Model, requests, inputTokens, outputTokens };
  });
  const routing = routeRows.map((row) => {
    const requests = parseCount(row.Requests);
    if (!row["Model ID"] || requests === null) {
      throw new Error(`Unrecognized Amp usage routing row: ${JSON.stringify(row)}`);
    }
    return { modelId: row["Model ID"], purpose: row.Purpose ?? "", requests };
  });

  const report: AmpDayReport = {
    inputTokens: parseCount(input[1])!,
    cacheReadTokens: parseCount(input[2]) ?? 0,
    outputTokens: parseCount(output[1])!,
    models,
    routing,
  };
  if (
    sum(models.map((m) => m.inputTokens)) !== report.inputTokens ||
    sum(models.map((m) => m.outputTokens)) !== report.outputTokens ||
    sum(models.map((m) => m.requests)) !== sum(routing.map((r) => r.requests))
  ) {
    throw new Error("Amp usage report tables do not add up to its totals");
  }
  return report;
}

// "openai/gpt-6.1-sol" -> "gpt-6.1-sol"
export function stripProvider(modelId: string): string {
  return modelId.slice(modelId.lastIndexOf("/") + 1);
}

function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Match display names ("Opus 5.5") to routing ids
// ("anthropic/claude-opus-5-5") by request count, using the name only to
// break ties. Returns null when the match is ambiguous.
function routeIdsByModel(report: AmpDayReport): Map<AmpReportModel, string> | null {
  const requestsById = new Map<string, number>();
  for (const route of report.routing) {
    requestsById.set(route.modelId, (requestsById.get(route.modelId) ?? 0) + route.requests);
  }

  const assigned = new Set<string>();
  const result = new Map<AmpReportModel, string>();
  for (const model of report.models) {
    let candidates = [...requestsById]
      .filter(([id, requests]) => !assigned.has(id) && requests === model.requests)
      .map(([id]) => id);
    if (candidates.length > 1) {
      candidates = candidates.filter((id) => squash(id).includes(squash(model.name)));
    }
    if (candidates.length !== 1) return null;
    assigned.add(candidates[0]!);
    result.set(model, candidates[0]!);
  }
  return result;
}

interface AgentTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

function sumAgentUsage(entries: AmpUsageEntry[]): Map<string, AgentTotals> {
  const byModel = new Map<string, AgentTotals>();
  for (const entry of entries) {
    const totals = byModel.get(entry.model) ?? {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
    totals.requests++;
    totals.inputTokens += entry.inputTokens;
    totals.outputTokens += entry.outputTokens;
    totals.cacheCreationTokens += entry.cacheCreationTokens;
    totals.cacheReadTokens += entry.cacheReadTokens;
    byModel.set(entry.model, totals);
  }
  return byModel;
}

// Export model names can differ from routing ids ("deepseek-flash" vs
// "deepseek/deepseek-v4.1-flash"), so match by exact id first, then by the
// route's Agent request count, then by shared name parts.
function matchRouteId(
  exportModel: string,
  requests: number,
  candidateIds: string[],
  report: AmpDayReport,
): string | null {
  const exact = candidateIds.find((id) => stripProvider(id) === stripProvider(exportModel));
  if (exact) return exact;

  const agentRequests = (id: string) =>
    sum(
      report.routing
        .filter((route) => route.modelId === id && route.purpose === "Agent")
        .map((route) => route.requests),
    );
  const byCount = candidateIds.filter((id) => agentRequests(id) === requests);
  if (byCount.length === 1) return byCount[0]!;

  const parts = stripProvider(exportModel)
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter((part) => /[a-z]/.test(part));
  const byName = candidateIds.filter((id) => {
    const target = stripProvider(id).toLowerCase();
    return parts.filter((part) => target.includes(part)).length >= 2;
  });
  return byName.length === 1 ? byName[0]! : null;
}

export interface MergedDayUsage {
  breakdowns: ModelBreakdown[];
  // Export model name -> report model name (e.g. deepseek-flash ->
  // deepseek-v4.1-flash), so days without a report use the same names
  aliases: Map<string, string>;
}

// Per-model usage for one thread-day. Input and output per model come from
// the report (main agent + subagents). The cache split is exact for the main
// agent's share (from the export) and estimated for the subagent share.
// Returns null when report and export cannot be reconciled.
export function mergeDayUsage(
  report: AmpDayReport,
  agentEntries: AmpUsageEntry[],
): MergedDayUsage | null {
  const routeIdOf = routeIdsByModel(report);
  if (!routeIdOf) return null;

  const counted = report.models.filter(
    (model) => !routeIdOf.get(model)!.startsWith(EXTERNAL_AGENT_PREFIX),
  );

  const agentByRouteId = new Map<string, AgentTotals>();
  const aliases = new Map<string, string>();
  for (const [exportModel, totals] of sumAgentUsage(agentEntries)) {
    const freeIds = counted
      .map((model) => routeIdOf.get(model)!)
      .filter((id) => !agentByRouteId.has(id));
    const routeId = matchRouteId(exportModel, totals.requests, freeIds, report);
    if (!routeId) return null;
    agentByRouteId.set(routeId, totals);
    aliases.set(exportModel, stripProvider(routeId));
  }

  const rows = counted.map((model) => {
    const routeId = routeIdOf.get(model)!;
    const agent = agentByRouteId.get(routeId);
    const agentInput = agent
      ? agent.inputTokens + agent.cacheCreationTokens + agent.cacheReadTokens
      : 0;
    return { model, routeId, agent, subagentInput: model.inputTokens - agentInput };
  });
  if (rows.some((row) => row.subagentInput < 0)) return null;

  // The report splits cache reads per thread-day only. Give the counted
  // models their input share of them (external-agent rows keep theirs);
  // whatever the export does not explain belongs to subagent input.
  const countedInput = sum(counted.map((model) => model.inputTokens));
  const countedCacheReads =
    report.inputTokens > 0
      ? Math.round((report.cacheReadTokens * countedInput) / report.inputTokens)
      : 0;
  const agentCacheReads = sum(rows.map((row) => row.agent?.cacheReadTokens ?? 0));
  const subagentInput = sum(rows.map((row) => row.subagentInput));
  const subagentCacheReads = Math.min(
    Math.max(countedCacheReads - agentCacheReads, 0),
    subagentInput,
  );

  const breakdowns = rows.map((row) => {
    const cacheReads =
      subagentInput > 0
        ? Math.round((subagentCacheReads * row.subagentInput) / subagentInput)
        : 0;
    return {
      modelName: stripProvider(row.routeId),
      inputTokens: (row.agent?.inputTokens ?? 0) + row.subagentInput - cacheReads,
      outputTokens: row.model.outputTokens,
      cacheCreationTokens: row.agent?.cacheCreationTokens ?? 0,
      cacheReadTokens: (row.agent?.cacheReadTokens ?? 0) + cacheReads,
      cost: 0,
    };
  });
  return { breakdowns, aliases };
}
