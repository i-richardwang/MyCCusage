// Antigravity conversation parsing, ported from T3 Code
// (https://github.com/pingdotgg/t3code, apps/server/src/provider/Drivers/antigravityUsageReader.ts).
/*
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import { type Dirent } from "fs";
import { readdir, realpath, stat } from "fs/promises";
import { homedir } from "os";
import { basename, join } from "path";
import { hexBytes, withDatabase, type Query } from "../sqlite.js";
import { existingDirs, realDirectory } from "./files.js";
import type { UsageRequest } from "./types.js";

// --- Protobuf ---------------------------------------------------------------
// Antigravity stores each generation's metadata as a protobuf message. Only
// the field numbers below are known; everything else is decoded generically.

type FieldValue = number | bigint | Uint8Array;
type Fields = Map<number, FieldValue[]>;

function fields(bytes: Uint8Array): Fields {
  let offset = 0;
  const result: Fields = new Map();
  const varint = () => {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      const byte = bytes[offset++];
      if (byte === undefined || (shift === 63n && byte > 1)) {
        throw new Error("Invalid Antigravity protobuf varint");
      }
      value |= BigInt(byte & 127) << shift;
      if (byte < 128) {
        return value > BigInt(Number.MAX_SAFE_INTEGER) ? value : Number(value);
      }
    }
    throw new Error("Invalid Antigravity protobuf varint");
  };
  while (offset < bytes.length) {
    const tag = varint();
    if (typeof tag !== "number") throw new Error("Invalid protobuf field");
    const number = Math.floor(tag / 8);
    const wire = tag % 8;
    if (number === 0) throw new Error("Invalid protobuf field");
    let value: FieldValue;
    if (wire === 0) {
      value = varint();
    } else if (wire === 1 || wire === 5 || wire === 2) {
      const length = wire === 2 ? varint() : wire === 1 ? 8 : 4;
      if (typeof length !== "number")
        throw new Error("Invalid protobuf field length");
      if (length > bytes.length - offset)
        throw new Error("Truncated protobuf field");
      value = bytes.subarray(offset, offset + length);
      offset += length;
      // Fixed-width fields are never read
      if (wire !== 2) continue;
    } else {
      throw new Error("Unsupported protobuf wire type");
    }
    const entries = result.get(number) ?? [];
    entries.push(value);
    result.set(number, entries);
  }
  return result;
}

const numberAt = (value: Fields, key: number) => {
  const entry = value.get(key)?.[0];
  return typeof entry === "number" ? entry : 0;
};
const bytesAt = (value: Fields, key: number) => {
  const entry = value.get(key)?.[0];
  return entry instanceof Uint8Array ? entry : undefined;
};
const nested = (value: Fields, key: number) => {
  const bytes = bytesAt(value, key);
  return bytes === undefined ? new Map<number, FieldValue[]>() : fields(bytes);
};
const textAt = (value: Fields, key: number) => {
  const bytes = bytesAt(value, key);
  return bytes === undefined
    ? ""
    : new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
};
// A google.protobuf.Timestamp: seconds and nanoseconds
const timestamp = (value: Fields) => {
  const seconds = numberAt(value, 1);
  return seconds > 0
    ? seconds * 1000 + Math.floor(numberAt(value, 2) / 1_000_000)
    : null;
};

// --- Models -----------------------------------------------------------------

const MODEL_IDS: Record<number, string> = {
  246: "gemini-2.5-pro",
  312: "gemini-2.5-flash",
  313: "gemini-2.5-flash-thinking",
  329: "gemini-2.5-flash-thinking",
  330: "gemini-2.5-flash-lite",
  281: "claude-sonnet-4",
  282: "claude-sonnet-4",
  290: "claude-opus-4",
  291: "claude-opus-4",
  333: "claude-sonnet-4-5",
  334: "claude-sonnet-4-5",
  340: "claude-haiku-4-5",
  341: "claude-haiku-4-5",
  1026: "claude-opus-4-6",
  1035: "claude-sonnet-4-6",
  1016: "gemini-3.1-pro",
  1036: "gemini-3.1-pro",
  1037: "gemini-3.1-pro",
  1018: "gemini-3-flash-preview",
  1084: "gemini-3-flash-preview",
  1047: "gemini-3-flash-preview",
};

// Model slug from the display name Antigravity records, else from its model
// id. "" when neither names a model.
function modelName(name: string, id: number): string {
  if (name) {
    const normalized = name
      .toLowerCase()
      .replace(/\s*\([^)]*\)\s*$/, "")
      .replaceAll(" ", "-");
    if (normalized.startsWith("claude-")) {
      return normalized
        .replace(/^claude-(4(?:\.\d+)?)-(sonnet|opus|haiku)/, "claude-$2-$1")
        .replaceAll(".", "-");
    }
    return normalized;
  }
  return MODEL_IDS[id] ?? (id > 0 ? `antigravity-model-${id}` : "");
}

// ACP sessions name the thinking level after the model; it shares the base
// model's prices
function withRateModel(request: UsageRequest): UsageRequest {
  const rateModel = request.model.replace(/-(?:low|medium|high)$/, "");
  return rateModel === request.model ? request : { ...request, rateModel };
}

// --- Metadata ---------------------------------------------------------------

interface Metadata {
  model: string;
  timestampMs: number | null;
  // The generation's token usage, then each retry's
  usages: Fields[];
}

// A `gen_metadata` row (generation) or a `steps` row (step) decoded to what
// usage needs. The two messages lay the same information out differently.
function metadata(bytes: Uint8Array, step: boolean): Metadata {
  const root = fields(bytes);
  if (!step && bytesAt(root, 1) === undefined) {
    throw new Error("Missing Antigravity generation metadata");
  }
  const data = step ? root : nested(root, 1);
  const model = step ? nested(data, 24) : data;
  const usage = bytesAt(data, step ? 9 : 4);
  // Copy the usage bytes: a subarray would keep the row's whole blob alive
  const usages = usage === undefined ? [] : [fields(usage.slice())];
  for (const retry of data.get(step ? 28 : 17) ?? []) {
    if (!(retry instanceof Uint8Array))
      throw new Error("Invalid retry metadata");
    const retryUsage = bytesAt(fields(retry), 2);
    if (retryUsage !== undefined) usages.push(fields(retryUsage.slice()));
  }
  return {
    model: modelName(
      textAt(model, step ? 12 : 19) || textAt(model, step ? 8 : 21),
      numberAt(model, step ? 1 : 3),
    ),
    timestampMs: step
      ? (timestamp(nested(data, 8)) ?? timestamp(nested(data, 1)))
      : timestamp(nested(nested(data, 9), 4)),
    usages,
  };
}

interface Indexed {
  idx: number;
  entry: Metadata;
}

// Generation rows can hold megabytes of context; small pages bound what one
// statement materializes
const GENERATION_PAGE_ROWS = 8;
const STEP_PAGE_ROWS = 64;

// Rows of `table` in idx order, decoded. Rows are paged by rowid, which idx
// normally aliases; the sort covers layouts where it does not.
function readMetadata(
  query: Query,
  table: "gen_metadata" | "steps",
): Indexed[] {
  const step = table === "steps";
  const column = step ? "metadata" : "data";
  const pageRows = step ? STEP_PAGE_ROWS : GENERATION_PAGE_ROWS;
  const entries: Indexed[] = [];
  let after = -1;
  for (;;) {
    const rows = query(
      `SELECT rowid AS row_id, idx, hex(${column}) AS data FROM ${table}
       WHERE rowid > ${after} ORDER BY rowid LIMIT ${pageRows}`,
    );
    for (const row of rows) {
      const data = hexBytes(row.data);
      // Steps without metadata are not generations
      if (step && data === null) continue;
      if (data === null) throw new Error("Missing Antigravity metadata blob");
      if (typeof row.idx !== "number") throw new Error("Invalid idx column");
      entries.push({ idx: row.idx, entry: metadata(data, step) });
    }
    if (rows.length < pageRows) break;
    const last = rows[rows.length - 1]!.row_id;
    if (typeof last !== "number") throw new Error("Invalid rowid column");
    after = last;
  }
  return entries.sort((a, b) => a.idx - b.idx);
}

// --- Candidates -------------------------------------------------------------

// A request before deduplication. Antigravity records a generation in several
// places; `keys` are the identities any two records of one request share.
interface Candidate {
  request: UsageRequest;
  keys: readonly string[];
  // 2: the row's own time; 1: the conversation's; 0: the file's last write
  timestampQuality: number;
}

// Usage records of one conversation database
function readDatabase(
  path: string,
  sessionId: string,
  fallbackTimestamp: number,
): Candidate[] {
  return withDatabase(path, (query) => {
    const tables = new Set(
      query("SELECT name FROM sqlite_master WHERE type = 'table'").map(
        (row) => row.name,
      ),
    );
    if (!tables.has("gen_metadata") && !tables.has("steps")) {
      throw new Error("no gen_metadata or steps table");
    }
    const generations = tables.has("gen_metadata")
      ? readMetadata(query, "gen_metadata")
      : [];
    let trajectoryTimestamp: number | null = null;
    if (tables.has("trajectory_metadata_blob")) {
      for (const row of query(
        "SELECT hex(data) AS data FROM trajectory_metadata_blob",
      )) {
        const data = hexBytes(row.data);
        if (data === null) continue;
        trajectoryTimestamp ??= timestamp(nested(fields(data), 2));
      }
    }
    const steps = tables.has("steps") ? readMetadata(query, "steps") : [];
    return candidates(
      sessionId,
      generations,
      steps,
      trajectoryTimestamp,
      fallbackTimestamp,
    );
  });
}

function candidates(
  sessionId: string,
  generations: readonly Indexed[],
  steps: readonly Indexed[],
  trajectoryTimestamp: number | null,
  fallbackTimestamp: number,
): Candidate[] {
  const result: Candidate[] = [];
  const generationModels = new Map(
    generations.map(({ idx, entry }) => [idx, entry.model]),
  );
  for (const [source, entries] of [
    ["step", steps],
    ["generation", generations],
  ] as const) {
    for (const [index, { idx, entry }] of entries.entries()) {
      for (const [usageIndex, usage] of entry.usages.entries()) {
        const outputTokens = Math.max(
          numberAt(usage, 3),
          numberAt(usage, 9) + numberAt(usage, 10),
        );
        const inputTokens = numberAt(usage, 2);
        const cacheReadTokens = numberAt(usage, 5);
        const cacheCreationTokens = numberAt(usage, 4);
        if (
          inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens ===
          0
        )
          continue;
        const keys = ([11, 12, 7] as const).flatMap((key) => {
          const id = textAt(usage, key);
          return id ? [`antigravity:${key}:${id}`] : [];
        });
        result.push({
          request: {
            timestampMs:
              entry.timestampMs ?? trajectoryTimestamp ?? fallbackTimestamp,
            model:
              MODEL_IDS[numberAt(usage, 1)] ||
              entry.model ||
              (source === "step" ? generationModels.get(idx) : "") ||
              modelName("", numberAt(usage, 1)),
            sessionId,
            inputTokens,
            outputTokens,
            cacheCreationTokens,
            cacheCreation1hTokens: 0,
            cacheReadTokens,
            reasoningTokens: Math.min(outputTokens, numberAt(usage, 9)),
            reportedCost: null,
            speed: "standard",
            dedupeKey:
              keys[0] ??
              `antigravity:${sessionId}:${source}:${index}:${usageIndex}`,
          },
          keys,
          timestampQuality:
            entry.timestampMs !== null
              ? 2
              : trajectoryTimestamp !== null
                ? 1
                : 0,
        });
      }
    }
  }
  return result;
}

// --- Reading ----------------------------------------------------------------

// A candidate joined to the others of its request, as a disjoint-set node
interface Group extends Candidate {
  parent: number;
  size: number;
  // The earliest candidate read, whose identity and file the request keeps
  owner: number;
  fileIndex: number;
}

/**
 * Requests of every conversation database under the directories, one list
 * per database. Antigravity writes a generation to its steps, its generation
 * metadata and every retry, and a backup root may hold a copy, so records
 * sharing a response, provider or message id are merged into one request. The
 * merged request keeps the first record's identity and file, the best-known
 * time, and the largest of each token count. Requests dated before `sinceMs`
 * are left out, but every database is read to find them: a record's time is
 * final only once its aliases are known.
 */
export async function readAntigravityUsage(
  conversationDirs: readonly string[],
  sinceMs: number,
): Promise<UsageRequest[][]> {
  const files: UsageRequest[][] = [];
  const groups: Group[] = [];
  const identities = new Map<string, number>();
  const find = (index: number): number => {
    let root = index;
    while (groups[root]!.parent !== root) root = groups[root]!.parent;
    while (index !== root) {
      const parent = groups[index]!.parent;
      groups[index]!.parent = root;
      index = parent;
    }
    return root;
  };
  const merge = (left: number, right: number): void => {
    let a = find(left);
    let b = find(right);
    if (a === b) return;
    if (groups[a]!.size < groups[b]!.size) [a, b] = [b, a];
    const target = groups[a]!;
    const source = groups[b]!;
    const first = target.owner < source.owner ? target : source;
    const bestTime =
      source.timestampQuality > target.timestampQuality ||
      (source.timestampQuality === target.timestampQuality &&
        source.request.timestampMs < target.request.timestampMs)
        ? source
        : target;
    const x = target.request;
    const y = source.request;
    target.request = {
      ...first.request,
      model:
        first.request.model === ""
          ? first === target
            ? source.request.model
            : target.request.model
          : first.request.model,
      timestampMs: bestTime.request.timestampMs,
      inputTokens: Math.max(x.inputTokens, y.inputTokens),
      cacheReadTokens: Math.max(x.cacheReadTokens, y.cacheReadTokens),
      cacheCreationTokens: Math.max(
        x.cacheCreationTokens,
        y.cacheCreationTokens,
      ),
      outputTokens: Math.max(x.outputTokens, y.outputTokens),
      reasoningTokens: Math.max(x.reasoningTokens ?? 0, y.reasoningTokens ?? 0),
    };
    target.timestampQuality = bestTime.timestampQuality;
    target.owner = first.owner;
    target.fileIndex = first.fileIndex;
    target.size += source.size;
    source.parent = a;
  };
  const append = (candidate: Candidate, fileIndex: number) => {
    const index = groups.length;
    groups.push({
      ...candidate,
      parent: index,
      size: 1,
      owner: index,
      fileIndex,
    });
    for (const key of candidate.keys) {
      const existing = identities.get(key);
      if (existing !== undefined) merge(index, existing);
      identities.set(key, index);
    }
  };

  const visited = new Set<string>();
  const walk = async (directory: string): Promise<void> => {
    const entries: Dirent[] = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name.endsWith(".db")) {
        // One database reachable from two roots is read once
        const canonical = await realpath(path);
        if (visited.has(canonical)) continue;
        visited.add(canonical);
        const { mtimeMs } = await stat(path);
        let read: Candidate[];
        try {
          read = readDatabase(path, basename(path, ".db"), mtimeMs);
        } catch (error) {
          throw new Error(
            `Cannot read Antigravity conversation ${path}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const fileIndex = files.length;
        files.push([]);
        for (const candidate of read) append(candidate, fileIndex);
      }
    }
  };
  for (const dir of conversationDirs) await walk(dir);

  for (const [index, group] of groups.entries()) {
    if (group.parent === index && group.request.timestampMs >= sinceMs) {
      files[group.fileIndex]!.push(withRateModel(group.request));
    }
  }
  return files;
}

/**
 * Antigravity conversation directories: `conversations/` under each data
 * root, or the root itself when it holds the databases directly. Roots are
 * ANTIGRAVITY_DATA_DIR (comma-separated), else `~/.gemini/antigravity`,
 * `~/.gemini/antigravity-cli`, `~/.gemini/antigravity-ide`,
 * `~/.gemini/antigravity-backup` and `~/.config/antigravity`. Missing
 * defaults are skipped; explicit roots must exist. A directory listed twice
 * is read once.
 */
export function antigravityConversationDirs(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = env.ANTIGRAVITY_DATA_DIR?.split(",")
    .map((dir) => dir.trim())
    .filter(Boolean);
  const roots = configured?.length
    ? configured
    : [
        ...[
          "antigravity",
          "antigravity-cli",
          "antigravity-ide",
          "antigravity-backup",
        ].map((name) => join(homedir(), ".gemini", name)),
        join(homedir(), ".config", "antigravity"),
      ];
  const dirs: string[] = [];
  for (const root of existingDirs(
    roots,
    Boolean(configured?.length),
    "Antigravity",
  )) {
    const dir = realDirectory(join(root, "conversations")) ?? root;
    if (!dirs.includes(dir)) dirs.push(dir);
  }
  return dirs;
}
