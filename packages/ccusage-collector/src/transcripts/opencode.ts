// OpenCode message parsing, ported from T3 Code
// (https://github.com/pingdotgg/t3code, packages/provider-opencode/src/server/usage.ts).
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
import { readdir, readFile, stat } from "fs/promises";
import { homedir } from "os";
import { isAbsolute, join } from "path";
import { withDatabase, type Query } from "../sqlite.js";
import { existingDirs, isMissing } from "./files.js";
import { isRecord, tokenCount, type UsageRequest } from "./types.js";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

interface MessageSource {
  // The row's own columns, used where the JSON lacks the field
  id?: string;
  sessionId?: string;
  timestampMs?: number;
}

/**
 * One assistant message as OpenCode stores it: a JSON document whose
 * `tokens` count the request behind it. OpenCode's `output` excludes
 * reasoning, which is reported apart; both are output here. Messages without
 * a model, time or tokens are not requests.
 */
export function parseOpenCodeMessage(
  source: string,
  row: MessageSource = {},
): UsageRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const message = parsed;
  if (message.role !== undefined && message.role !== "assistant") return null;
  const usage = isRecord(message.tokens) ? message.tokens : {};
  const cache = isRecord(usage.cache) ? usage.cache : {};
  const modelReference = isRecord(message.model) ? message.model : {};
  const model =
    text(modelReference.id) ||
    text(modelReference.modelID) ||
    text(message.modelID);
  const time = isRecord(message.time) ? message.time : {};
  const timestampMs =
    typeof time.created === "number" ? time.created : row.timestampMs;
  if (
    !model ||
    typeof timestampMs !== "number" ||
    !Number.isFinite(timestampMs)
  )
    return null;

  const reasoningTokens = tokenCount(usage.reasoning);
  const request: UsageRequest = {
    timestampMs,
    model,
    sessionId: row.sessionId || text(message.sessionID),
    inputTokens: tokenCount(usage.input),
    outputTokens: tokenCount(usage.output) + reasoningTokens,
    cacheCreationTokens: tokenCount(cache.write),
    cacheCreation1hTokens: 0,
    cacheReadTokens: tokenCount(cache.read),
    reasoningTokens,
    // OpenCode records zero for rates it does not know, including paid
    // subscriptions; such requests are priced from the table
    reportedCost:
      typeof message.cost === "number" &&
      Number.isFinite(message.cost) &&
      message.cost > 0
        ? message.cost
        : null,
    speed: "standard",
    dedupeKey: null,
  };
  if (
    request.inputTokens +
      request.outputTokens +
      request.cacheCreationTokens +
      request.cacheReadTokens ===
    0
  )
    return null;
  const id = row.id || text(message.id);
  if (id) request.dedupeKey = `opencode:${id}`;
  return request;
}

// Messages of one database's tables. The current schema is `message`; older
// stores name it `session_message` with a `type` column. Either may lack
// `time_created`, in which case every row is read and dated from its JSON.
function readDatabaseMessages(query: Query, sinceMs: number): UsageRequest[] {
  const requests: UsageRequest[] = [];
  const tables = new Set(
    query("SELECT name FROM sqlite_master WHERE type = 'table'").map(
      (row) => row.name,
    ),
  );
  if (!tables.has("message") && !tables.has("session_message")) {
    throw new Error("no message table");
  }
  for (const table of ["message", "session_message"] as const) {
    if (!tables.has(table)) continue;
    const columns = new Set(
      query(`PRAGMA table_info(${table})`).map((row) => row.name),
    );
    const predicates: string[] = [];
    if (table === "session_message") predicates.push("type = 'assistant'");
    const dated = columns.has("time_created");
    if (dated && Number.isFinite(sinceMs)) {
      predicates.push(`time_created >= ${Math.trunc(sinceMs)}`);
    }
    const rows = query(
      `SELECT id, session_id, data, ${dated ? "time_created" : "NULL"} AS created
       FROM ${table}${predicates.length ? ` WHERE ${predicates.join(" AND ")}` : ""}
       ORDER BY rowid`,
    );
    for (const row of rows) {
      const request = parseOpenCodeMessage(text(row.data), {
        id: text(row.id),
        sessionId: text(row.session_id),
        ...(typeof row.created === "number"
          ? { timestampMs: row.created }
          : {}),
      });
      if (request) requests.push(request);
    }
  }
  return requests;
}

const DATABASE_NAME = /^opencode(?:-[a-zA-Z0-9_-]+)?\.db$/;

/**
 * Requests in one OpenCode data directory: its `opencode*.db` databases and
 * the message files of the JSON store that preceded them, written at or
 * after `sinceMs`. A message migrated into the database keeps its id, so the
 * caller's deduplication counts it once. Symbolic links are not followed.
 */
export async function readOpenCodeUsage(
  root: string,
  sinceMs: number,
): Promise<UsageRequest[][]> {
  const files: UsageRequest[][] = [];
  const entries: Dirent[] = await readdir(root, { withFileTypes: true });
  const databases = entries
    .filter((entry) => entry.isFile() && DATABASE_NAME.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) =>
      a === "opencode.db" ? -1 : b === "opencode.db" ? 1 : a.localeCompare(b),
    );
  for (const name of databases) {
    const path = join(root, name);
    try {
      files.push(
        withDatabase(path, (query) => readDatabaseMessages(query, sinceMs)),
      );
    } catch (error) {
      throw new Error(
        `Cannot read OpenCode database ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const directories = [join(root, "storage", "message")];
  while (directories.length > 0) {
    const directory = directories.pop()!;
    let names: Dirent[];
    try {
      names = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    for (const entry of names) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        directories.push(path);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        // A message cannot postdate its file's last write
        const { mtimeMs } = await stat(path);
        if (mtimeMs < sinceMs) continue;
        const request = parseOpenCodeMessage(await readFile(path, "utf8"), {
          id: entry.name.slice(0, -5),
        });
        if (request) files.push([request]);
      }
    }
  }
  return files;
}

/**
 * OpenCode data directories: OPENCODE_DATA_DIR (comma-separated), else
 * `$XDG_DATA_HOME/opencode`, else `~/.local/share/opencode`. Missing defaults
 * are skipped; explicit directories must exist. A directory listed twice is
 * read once.
 */
export function openCodeDataDirs(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = env.OPENCODE_DATA_DIR?.split(",")
    .map((dir) => dir.trim())
    .filter(Boolean);
  const dataHome = env.XDG_DATA_HOME?.trim();
  const entries = configured?.length
    ? configured
    : [
        join(
          dataHome && isAbsolute(dataHome)
            ? dataHome
            : join(homedir(), ".local", "share"),
          "opencode",
        ),
      ];
  return existingDirs(entries, Boolean(configured?.length), "OpenCode");
}
