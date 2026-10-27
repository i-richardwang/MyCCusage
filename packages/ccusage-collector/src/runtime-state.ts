import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { randomUUID } from "crypto";
import lockfile from "proper-lockfile";

const LOCK_STALE_MS = 60_000;
const LOCK_UPDATE_MS = 10_000;

export function collectorDirectory(): string {
  return join(homedir(), ".ccusage-collector");
}

export class CollectorBusyError extends Error {}

export function writePrivateJSON(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function readJSON<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Unable to read valid state at ${path}`);
  }
}

/** All CLI operations touching collection caches use the same heartbeat lock. */
export async function acquireLock(
  name: "sync" | "service",
  directory = collectorDirectory(),
): Promise<() => Promise<void>> {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    return await lockfile.lock(join(directory, name), {
      realpath: false,
      stale: LOCK_STALE_MS,
      update: LOCK_UPDATE_MS,
      retries: 0,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOCKED") {
      throw new CollectorBusyError(
        `Another collector ${name} operation is running. Try again after it finishes.`,
      );
    }
    throw error;
  }
}

export interface SyncState {
  startedAt: string;
  finishedAt?: string;
  lastSuccessAt?: string;
  result: "running" | "success" | "partial" | "error" | "interrupted";
  error?: string;
  failedAgents?: string[];
}

export async function syncIsRunning(
  directory = collectorDirectory(),
): Promise<boolean> {
  return lockfile.check(join(directory, "sync"), {
    realpath: false,
    stale: LOCK_STALE_MS,
  });
}

export async function trackSync<T extends { failedAgents: string[] }>(
  action: () => Promise<T>,
  secret: string,
): Promise<T> {
  const path = join(collectorDirectory(), "sync-state.json");
  const previous = readJSON<SyncState>(path);
  const state: SyncState = {
    startedAt: new Date().toISOString(),
    lastSuccessAt: previous?.lastSuccessAt,
    result: "running",
  };
  writePrivateJSON(path, state);
  try {
    const result = await action();
    state.result = result.failedAgents.length ? "partial" : "success";
    state.failedAgents = result.failedAgents;
    if (state.result === "success")
      state.lastSuccessAt = new Date().toISOString();
    return result;
  } catch (error) {
    state.result = "error";
    state.error = (error instanceof Error ? error.message : "Sync failed")
      .split(secret)
      .join("[redacted]");
    throw error;
  } finally {
    state.finishedAt = new Date().toISOString();
    writePrivateJSON(path, state);
  }
}
