import { execFile, spawn } from "child_process";
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_ENV_VARS } from "../src/config";
import type { UsageData } from "../src/types";

const execFileAsync = promisify(execFile);
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const packageDir = fileURLToPath(new URL("..", import.meta.url));

// Exercise the real CLI with synthetic usage and a local receiver only.
describe("environment-configured CLI", () => {
  let home: string;
  let env: NodeJS.ProcessEnv;
  let server: Server;
  let uploads: { data: UsageData; apiKey: string | string[] | undefined }[];

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "myccusage-cli-test-"));
    const bin = join(home, "bin");
    mkdirSync(bin);
    // Bypass user shell startup files, but still execute the collector's commands.
    const shell = join(bin, "test-shell");
    writeFileSync(shell, '#!/bin/sh\nexec /bin/sh -c "$2"\n', { mode: 0o700 });
    writeFileSync(
      join(bin, "ccusage"),
      `#!/bin/sh
case "$1" in claude|codex) ;; *) exit 1 ;; esac
printf '%s\\n' '{"daily":[{"date":"2026-10-26","inputTokens":10,"outputTokens":5,"totalTokens":15,"costUSD":0.01}],"totals":{"inputTokens":10,"outputTokens":5,"cacheCreationTokens":0,"cacheReadTokens":0,"totalTokens":15,"totalCost":0.01}}'
`,
      { mode: 0o700 },
    );

    uploads = [];
    server = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      uploads.push({
        data: JSON.parse(body),
        apiKey: req.headers["x-api-key"],
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, processed: 1, results: [] }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test receiver address");
    env = { ...process.env };
    for (const name of Object.values(CONFIG_ENV_VARS)) delete env[name];
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
    expect(
      uploads.every(
        ({ data, apiKey }) =>
          data.daily[0]?.totalTokens === 15 && apiKey === "test-api-key",
      ),
    ).toBe(true);
    expect(existsSync(join(home, ".ccusage-collector"))).toBe(false);
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
    expect(existsSync(join(home, ".ccusage-collector"))).toBe(false);
  });

  it("keeps an existing config byte-for-byte unchanged after sync", async () => {
    const dir = join(home, ".ccusage-collector");
    mkdirSync(dir);
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
    expect(existsSync(join(home, ".ccusage-collector"))).toBe(false);
  });

  it("returns a nonzero status when no agents can sync", async () => {
    writeFileSync(join(home, "bin/ccusage"), "#!/bin/sh\nexit 1\n");
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
    expect(existsSync(join(home, ".ccusage-collector"))).toBe(false);
  });

  it("shows the resolved device and accurately reports that no JSON file exists", async () => {
    const { stdout } = await runCLI("status");
    expect(stdout).toContain("No config file (using environment and defaults)");
    expect(stdout).toContain("Device ID: cloud-dev-01");
    expect(stdout).toContain("Device name: cloud-host");
    expect(stdout).toContain("Display name: Cloud development");
    expect(stdout).not.toContain("test-api-key");
    expect(existsSync(join(home, ".ccusage-collector"))).toBe(false);
  });

  it.each([false, true])(
    "runs the scheduler after initial collection (fails: %s)",
    async (fails) => {
      if (fails)
        writeFileSync(join(home, "bin/ccusage"), "#!/bin/sh\nexit 1\n");
      const child = spawn(process.execPath, ["--import", "tsx", cli, "start"], {
        cwd: packageDir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const exited = new Promise<number | null>((resolve) =>
        child.once("exit", resolve),
      );
      let stdout = "";
      let stderr = "";
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`CLI did not start: ${stdout}\n${stderr}`)),
            10_000,
          );
          function finish(error?: Error) {
            clearTimeout(timer);
            if (error) reject(error);
            else resolve();
          }
          child.once("error", (error) => finish(error));
          child.once("exit", (code) =>
            finish(new Error(`CLI exited early (${code}): ${stderr}`)),
          );
          child.stderr.on("data", (chunk) => {
            stderr += chunk;
          });
          child.stdout.on("data", (chunk) => {
            stdout += chunk;
            if (stdout.includes("Scheduled sync is running")) finish();
          });
        });
        expect(uploads).toHaveLength(fails ? 0 : 2);
        expect(existsSync(join(home, ".ccusage-collector"))).toBe(false);
      } finally {
        child.kill("SIGTERM");
        await exited;
      }
    },
  );
});
