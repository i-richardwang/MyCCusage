import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  acquireLock,
  readJSON,
  trackSync,
  type SyncState,
} from "../src/runtime-state";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "myccusage-runtime-"));
  vi.stubEnv("HOME", home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

it("excludes concurrent operations and releases after completion", async () => {
  const release = await acquireLock("sync");
  await expect(acquireLock("sync")).rejects.toThrow("Another collector sync");
  await release();
  const next = await acquireLock("sync");
  await next();
});

it("recovers an abandoned heartbeat lock", async () => {
  const path = join(home, ".ccusage-collector", "sync.lock");
  mkdirSync(path, { recursive: true });
  const past = new Date(Date.now() - 120_000);
  utimesSync(path, past, past);
  const release = await acquireLock("sync");
  await release();
  expect(existsSync(path)).toBe(false);
});

it("records complete and partial syncs without discarding the last full success", async () => {
  await trackSync(async () => ({ failedAgents: [] }), "secret");
  const path = join(home, ".ccusage-collector", "sync-state.json");
  const success = readJSON<SyncState>(path)!;
  expect(success.result).toBe("success");
  expect(success.lastSuccessAt).toBeTruthy();
  await trackSync(async () => ({ failedAgents: ["amp"] }), "secret");
  expect(readJSON(path)).toMatchObject({
    result: "partial",
    failedAgents: ["amp"],
    lastSuccessAt: success.lastSuccessAt,
  });
});

it("records errors while redacting credentials", async () => {
  await expect(
    trackSync(async () => {
      throw new Error("request failed with private-key");
    }, "private-key"),
  ).rejects.toThrow();
  const text = readFileSync(
    join(home, ".ccusage-collector", "sync-state.json"),
    "utf8",
  );
  expect(text).not.toContain("private-key");
  expect(JSON.parse(text)).toMatchObject({
    result: "error",
    error: "request failed with [redacted]",
    finishedAt: expect.any(String),
  });
});
