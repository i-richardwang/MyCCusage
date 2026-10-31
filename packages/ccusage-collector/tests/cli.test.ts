import { execFile } from "child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { createServer, type Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureServiceEnvironment } from "../src/service-environment";
import { CONFIG_ENV_VARS } from "../src/config";
import type { UsageData } from "../src/types";

type Upload = UsageData & { version: number };

const execFileAsync = promisify(execFile);
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const packageDir = fileURLToPath(new URL("..", import.meta.url));

// Today in the account zone the test receiver reports
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
}).format(new Date());

// One request in each agent's transcripts, an hour ago
function writeTranscripts(home: string) {
  const timestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const claude = join(home, ".claude/projects/-work-app");
  mkdirSync(claude, { recursive: true });
  writeFileSync(
    join(claude, "session-1.jsonl"),
    JSON.stringify({
      type: "assistant",
      timestamp,
      sessionId: "session-1",
      requestId: "req_1",
      message: {
        id: "msg_1",
        model: "claude-test",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    }) + "\n",
  );
  const codex = join(home, ".codex/sessions/2026/10/30");
  mkdirSync(codex, { recursive: true });
  writeFileSync(
    join(codex, "rollout-1.jsonl"),
    [
      { type: "session_meta", timestamp, payload: { id: "codex-1" } },
      { type: "turn_context", timestamp, payload: { model: "gpt-test" } },
      {
        type: "event_msg",
        timestamp,
        payload: {
          type: "token_count",
          info: { last_token_usage: { input_tokens: 10, output_tokens: 5 } },
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n") + "\n",
  );
}

// Exercise the real CLI with synthetic usage and a local receiver only.
describe("environment-configured CLI", () => {
  let home: string;
  let env: NodeJS.ProcessEnv;
  let server: Server;
  let uploads: { data: Upload; apiKey: string | string[] | undefined }[];

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "myccusage-cli-test-"));
    const bin = join(home, "bin");
    mkdirSync(bin);
    // Bypass user shell startup files, but still execute the collector's commands.
    const shell = join(bin, "test-shell");
    writeFileSync(shell, '#!/bin/sh\nexec /bin/sh -c "$2"\n', { mode: 0o700 });
    writeTranscripts(home);
    // Fresh cached prices keep the test offline
    mkdirSync(join(home, ".ccusage-collector"));
    writeFileSync(
      join(home, ".ccusage-collector/pricing.json"),
      JSON.stringify({
        asOf: new Date().toISOString(),
        models: {
          "claude-test": { input: 0.001, output: 0.001 },
          "gpt-test": { input: 0.001, output: 0.001 },
        },
      }),
    );

    uploads = [];
    server = createServer(async (req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.method === "GET") {
        res.end(JSON.stringify({ timezone: "Asia/Shanghai", protocol: 2 }));
        return;
      }
      let body = "";
      for await (const chunk of req) body += chunk;
      uploads.push({
        data: JSON.parse(body),
        apiKey: req.headers["x-api-key"],
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, days: ["2026-10-30"], buckets: 1 }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test receiver address");
    env = { ...process.env };
    for (const name of Object.values(CONFIG_ENV_VARS)) delete env[name];
    // Agents read only the synthetic transcripts under HOME
    delete env.CLAUDE_CONFIG_DIR;
    delete env.CODEX_HOME;
    Object.assign(env, {
      HOME: home,
      SHELL: shell,
      PATH: `${bin}:${env.PATH}`,
      NO_PROXY: "127.0.0.1",
      MYCCUSAGE_API_KEY: "test-api-key",
      MYCCUSAGE_ENDPOINT: `http://127.0.0.1:${address.port}/api/usage-sync`,
      MYCCUSAGE_AGENT_TYPES: " claude-code,codex,claude-code ",
      MYCCUSAGE_DEVICE_ID: "cloud-dev-01",
      MYCCUSAGE_DEVICE_NAME: "cloud-host",
      MYCCUSAGE_DISPLAY_NAME: "Cloud development",
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(home, { recursive: true, force: true });
  });

  function runCLI(...args: string[]) {
    return execFileAsync(process.execPath, ["--import", "tsx", cli, ...args], {
      cwd: packageDir,
      env,
      timeout: 10_000,
    });
  }

  it("syncs selected agents and device metadata using only environment variables", async () => {
    const { stdout } = await runCLI("sync");
    expect(stdout).toContain("Sync completed successfully");
    expect(uploads.map(({ data }) => data.device)).toEqual([
      {
        deviceId: "cloud-dev-01",
        deviceName: "cloud-host",
        displayName: "Cloud development",
        agentType: "claude-code",
      },
      {
        deviceId: "cloud-dev-01",
        deviceName: "cloud-host",
        displayName: "Cloud development",
        agentType: "codex",
      },
    ]);
    for (const { data, apiKey } of uploads) {
      expect(apiKey).toBe("test-api-key");
      expect(data).toMatchObject({ version: 2, timezone: "Asia/Shanghai" });
      expect(data.range).toEqual({
        from: data.buckets[0]?.date,
        to: today,
      });
      expect(data.buckets).toEqual([
        expect.objectContaining({
          inputTokens: 10,
          outputTokens: 5,
          requests: 1,
          cost: expect.closeTo(0.015, 9),
        }),
      ]);
    }
    expect(existsSync(join(home, ".ccusage-collector/config.json"))).toBe(
      false,
    );
  });

  it("generates device defaults without creating a config file", async () => {
    delete env.MYCCUSAGE_DEVICE_ID;
    delete env.MYCCUSAGE_DEVICE_NAME;
    delete env.MYCCUSAGE_DISPLAY_NAME;
    await runCLI("sync");
    expect(uploads[0]?.data.device.deviceId).toMatch(/^[a-f0-9]{32}$/);
    expect(uploads[0]?.data.device.deviceName).toBeTruthy();
    expect(uploads[1]?.data.device.deviceId).toBe(
      uploads[0]?.data.device.deviceId,
    );
    expect(existsSync(join(home, ".ccusage-collector/config.json"))).toBe(
      false,
    );
  });

  it("keeps an existing config byte-for-byte unchanged after sync", async () => {
    const dir = join(home, ".ccusage-collector");
    const configPath = join(dir, "config.json");
    const original =
      '{ "agentTypes": ["amp"], "deviceId": "file-id", "displayName": "File display" }\n';
    writeFileSync(configPath, original);
    await runCLI("sync");
    expect(readFileSync(configPath, "utf8")).toBe(original);
    expect(uploads[0]?.data.device.deviceId).toBe("cloud-dev-01");
  });

  it("reports missing configuration with an environment setup option", async () => {
    delete env.MYCCUSAGE_API_KEY;
    await expect(runCLI("sync")).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        "Set MYCCUSAGE_API_KEY and MYCCUSAGE_ENDPOINT",
      ),
    });
    expect(uploads).toHaveLength(0);
  });

  it("rejects invalid environment settings before collecting or uploading", async () => {
    env.MYCCUSAGE_AGENT_TYPES = "misplaced-secret-value";
    await expect(runCLI("sync")).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("MYCCUSAGE_AGENT_TYPES"),
    });
    try {
      await runCLI("status");
    } catch (error) {
      expect((error as { stderr: string }).stderr).not.toContain(
        "misplaced-secret-value",
      );
    }
    expect(uploads).toHaveLength(0);
    expect(existsSync(join(home, ".ccusage-collector/config.json"))).toBe(
      false,
    );
  });

  it("returns a nonzero status when no agents can sync", async () => {
    rmSync(join(home, ".claude"), { recursive: true });
    rmSync(join(home, ".codex"), { recursive: true });
    await expect(runCLI("sync")).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("No agents synced successfully"),
    });
    expect(uploads).toHaveLength(0);
  });

  it("collects in dry-run mode without uploading or creating configuration", async () => {
    const { stdout } = await runCLI("sync", "--dry-run");
    expect(stdout).toContain('"deviceId": "cloud-dev-01"');
    expect(stdout).toContain('"agentType": "codex"');
    expect(uploads).toHaveLength(0);
    expect(existsSync(join(home, ".ccusage-collector/config.json"))).toBe(
      false,
    );
  });

  it("shows the resolved device and accurately reports that no JSON file exists", async () => {
    const { stdout } = await runCLI("status");
    expect(stdout).toContain("No config file (using environment and defaults)");
    expect(stdout).toContain("Device ID: cloud-dev-01");
    expect(stdout).toContain("Device name: cloud-host");
    expect(stdout).toContain("Display name: Cloud development");
    expect(stdout).not.toContain("test-api-key");
    expect(existsSync(join(home, ".ccusage-collector/config.json"))).toBe(
      false,
    );
  });

  it("runs scheduled collection with its saved environment", async () => {
    const path = join(home, "environment.json");
    writeFileSync(path, JSON.stringify(captureServiceEnvironment(home, env)));
    const entry = fileURLToPath(
      new URL("../src/service-entry.ts", import.meta.url),
    );
    const childEnv = { ...process.env, SHELL: "/missing-manager-shell" };
    for (const name of Object.values(CONFIG_ENV_VARS)) delete childEnv[name];
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", entry, path],
      {
        cwd: packageDir,
        env: childEnv,
        timeout: 10_000,
      },
    );
    expect(stdout).toContain("Sync completed successfully");
    expect(uploads).toHaveLength(2);
    expect(uploads[0]?.apiKey).toBe("test-api-key");
  });

  it("reports native service status without credentials or installing tasks", async () => {
    delete env.MYCCUSAGE_API_KEY;
    const { stdout } = await runCLI("service", "status", "--json");
    expect(JSON.parse(stdout)).toMatchObject({
      installed: false,
      active: false,
    });
    expect(stdout).not.toContain("test-api-key");
  });

  it("refuses a second manual sync and skips overlapping scheduled syncs", async () => {
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    server.removeAllListeners("request");
    server.on("request", async (req, res) => {
      if (req.method === "GET") {
        res.end(JSON.stringify({ timezone: "Asia/Shanghai", protocol: 2 }));
        return;
      }
      let body = "";
      for await (const chunk of req) body += chunk;
      uploads.push({
        data: JSON.parse(body),
        apiKey: req.headers["x-api-key"],
      });
      await blocked;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, days: ["2026-10-30"], buckets: 1 }));
    });
    const first = runCLI("sync");
    try {
      await vi.waitFor(() => expect(uploads).toHaveLength(1));
      await expect(runCLI("sync")).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("Another collector sync"),
      });
      const environmentPath = join(home, "environment.json");
      writeFileSync(
        environmentPath,
        JSON.stringify(captureServiceEnvironment(home, env)),
      );
      const entry = fileURLToPath(
        new URL("../src/service-entry.ts", import.meta.url),
      );
      const skipped = await execFileAsync(
        process.execPath,
        ["--import", "tsx", entry, environmentPath],
        { cwd: packageDir, env, timeout: 10_000 },
      );
      expect(skipped.stdout).toContain("skipped");
      expect(uploads).toHaveLength(1);
    } finally {
      unblock();
      await first;
    }
    expect(
      JSON.parse(
        readFileSync(join(home, ".ccusage-collector/sync-state.json"), "utf8"),
      ),
    ).toMatchObject({ result: "success" });
  });
});
