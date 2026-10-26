import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { hostname, tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONFIG_ENV_VARS,
  ConfigManager,
  resolveConfig,
  formatSchedule,
} from "../src/config";

const credentials = {
  apiKey: "file-key",
  endpoint: "https://file.example.com/api/usage-sync",
};

describe("ConfigManager", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "myccusage-config-test-"));
    vi.stubEnv("HOME", home);
    for (const name of Object.values(CONFIG_ENV_VARS)) vi.stubEnv(name, "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  function writeFileConfig(config: unknown) {
    const dir = join(home, ".ccusage-collector");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  }

  function readFileConfig(): Record<string, unknown> {
    return JSON.parse(
      readFileSync(join(home, ".ccusage-collector", "config.json"), "utf8"),
    );
  }

  it("loads file values and resolves defaults without writing the file", () => {
    writeFileConfig({ ...credentials, agentTypes: ["dimagent"] });
    const manager = new ConfigManager();
    const before = readFileSync(manager.getConfigPath(), "utf8");

    expect(manager.loadConfig()).toMatchObject({
      ...credentials,
      agentTypes: ["dimagent"],
      deviceId: expect.stringMatching(/^[a-f0-9]{32}$/),
      deviceName: hostname(),
      schedule: "0 */4 * * *",
      maxRetries: 3,
      retryDelay: 1000,
    });
    expect(readFileSync(manager.getConfigPath(), "utf8")).toBe(before);
  });

  it("lets environment override every supported field", () => {
    writeFileConfig({
      ...credentials,
      agentTypes: ["dimagent"],
      deviceId: "file-id",
      deviceName: "file-host",
      displayName: "File display",
    });
    vi.stubEnv("MYCCUSAGE_API_KEY", " env-key ");
    vi.stubEnv(
      "MYCCUSAGE_ENDPOINT",
      " https://env.example.com/api/usage-sync ",
    );
    vi.stubEnv("MYCCUSAGE_AGENT_TYPES", " codex, claude-code,codex ");
    vi.stubEnv("MYCCUSAGE_DEVICE_ID", " env-id ");
    vi.stubEnv("MYCCUSAGE_DEVICE_NAME", " env-host ");
    vi.stubEnv("MYCCUSAGE_DISPLAY_NAME", " Cloud VM ");

    const manager = new ConfigManager();
    expect(manager.loadConfig()).toMatchObject({
      apiKey: "env-key",
      endpoint: "https://env.example.com/api/usage-sync",
      agentTypes: ["codex", "claude-code"],
      deviceId: "env-id",
      deviceName: "env-host",
      displayName: "Cloud VM",
    });
  });

  it("treats blank environment values as unset for all fields", () => {
    const fileConfig = {
      ...credentials,
      agentTypes: ["codex"],
      deviceId: "file-id",
      deviceName: "file-host",
      displayName: "File display",
    };
    writeFileConfig(fileConfig);
    for (const name of Object.values(CONFIG_ENV_VARS)) vi.stubEnv(name, " \t ");

    expect(new ConfigManager().loadConfig()).toMatchObject(fileConfig);
  });

  it("works with only environment credentials and creates no directory", () => {
    vi.stubEnv("MYCCUSAGE_API_KEY", "env-key");
    vi.stubEnv("MYCCUSAGE_ENDPOINT", credentials.endpoint);

    expect(new ConfigManager().loadConfig()).toMatchObject({
      apiKey: "env-key",
      endpoint: credentials.endpoint,
      agentTypes: ["claude-code"],
      deviceId: expect.any(String),
      deviceName: hostname(),
    });
    expect(existsSync(join(home, ".ccusage-collector"))).toBe(false);
  });

  it.each(["apiKey", "endpoint"])(
    "returns null when %s is missing",
    (field) => {
      const partial: Record<string, unknown> = { ...credentials };
      delete partial[field];
      writeFileConfig(partial);
      expect(new ConfigManager().loadConfig()).toBeNull();
    },
  );

  it.each([
    { deviceId: "fixed-id" },
    { deviceName: "fixed-name" },
    { displayName: "My VM" },
  ])("resolves partial device settings independently: %j", (device) => {
    writeFileConfig({ ...credentials, ...device });
    const config = new ConfigManager().loadConfig();
    expect(config).toMatchObject(device);
    expect(config?.deviceId).toBeTruthy();
    expect(config?.deviceName).toBeTruthy();
    if (!device.deviceName) expect(config?.deviceName).toBe(hostname());
  });

  it("overrides just the device ID while keeping the file's name", () => {
    writeFileConfig({
      ...credentials,
      deviceId: "file-id",
      deviceName: "file-host",
    });
    vi.stubEnv("MYCCUSAGE_DEVICE_ID", "env-id");
    expect(new ConfigManager().loadConfig()).toMatchObject({
      deviceId: "env-id",
      deviceName: "file-host",
    });
  });

  it("deduplicates agent arrays", () => {
    writeFileConfig({ ...credentials, agentTypes: ["amp", "amp", "codex"] });
    expect(new ConfigManager().loadConfig()?.agentTypes).toEqual([
      "amp",
      "codex",
    ]);
  });

  it.each(["unknown", "codex,unknown", ", ,", "codex,,amp"])(
    "rejects invalid MYCCUSAGE_AGENT_TYPES without echoing input: %s",
    (value) => {
      writeFileConfig(credentials);
      vi.stubEnv("MYCCUSAGE_AGENT_TYPES", value);
      expect(() => new ConfigManager().loadConfig()).toThrow(
        "MYCCUSAGE_AGENT_TYPES",
      );
      try {
        new ConfigManager().loadConfig();
      } catch (error) {
        expect((error as Error).message).not.toContain(value);
      }
    },
  );

  it.each([[], ["unknown"], "codex", [null]])(
    "rejects invalid agentTypes in JSON: %j",
    (value) => {
      writeFileConfig({ ...credentials, agentTypes: value });
      expect(() => new ConfigManager().loadConfig()).toThrow(
        "agentTypes in config",
      );
    },
  );

  it("allows a valid environment agent list to override an invalid file value", () => {
    writeFileConfig({ ...credentials, agentTypes: "invalid" });
    vi.stubEnv("MYCCUSAGE_AGENT_TYPES", "codex");
    expect(new ConfigManager().loadConfig()?.agentTypes).toEqual(["codex"]);
  });

  it.each(["not-a-url", "ftp://example.com"])(
    "rejects invalid endpoints: %s",
    (value) => {
      writeFileConfig(credentials);
      vi.stubEnv("MYCCUSAGE_ENDPOINT", value);
      expect(() => new ConfigManager().loadConfig()).toThrow(
        "MYCCUSAGE_ENDPOINT must be an absolute HTTP(S) URL",
      );
    },
  );

  it.each([
    { maxRetries: 0 },
    { maxRetries: 1.5 },
    { retryDelay: -1 },
    { deviceId: 123 },
    { schedule: "bad-cron" },
  ])("rejects invalid file settings: %j", (value) => {
    writeFileConfig({ ...credentials, ...value });
    expect(() => new ConfigManager().loadConfig()).toThrow();
  });

  it("accepts zero retry delay and formats schedules for display", () => {
    writeFileConfig({ ...credentials, retryDelay: 0, schedule: "0 * * * *" });
    expect(new ConfigManager().loadConfig()).toMatchObject({
      retryDelay: 0,
      schedule: "0 * * * *",
    });
    expect(formatSchedule("0 * * * *")).toBe("Every 1 hour");
    expect(formatSchedule("15 2 * * *")).toBe("15 2 * * *");
  });

  it.each([null, [], "text"])(
    "rejects a non-object config root: %j",
    (value) => {
      writeFileConfig(value);
      expect(() => new ConfigManager().loadConfig()).toThrow(
        "must contain a JSON object",
      );
    },
  );

  it("reports malformed JSON without leaking its contents", () => {
    writeFileConfig(credentials);
    const manager = new ConfigManager();
    writeFileSync(
      manager.getConfigPath(),
      '{"apiKey":"secret-that-must-stay-private",',
    );
    expect(() => manager.loadConfig()).toThrow(
      "Unable to read valid JSON config",
    );
    try {
      manager.loadConfig();
    } catch (error) {
      expect((error as Error).message).not.toContain(
        "secret-that-must-stay-private",
      );
    }
  });

  it("preserves original file values when saving under environment overrides", () => {
    const fileConfig = {
      ...credentials,
      agentTypes: ["claude-code"],
      deviceId: "file-id",
      deviceName: "file-host",
      displayName: "File display",
    };
    writeFileConfig(fileConfig);
    for (const name of Object.values(CONFIG_ENV_VARS))
      vi.stubEnv(name, "temporary-env-value");
    vi.stubEnv("MYCCUSAGE_ENDPOINT", "https://env.example.com/api/usage-sync");
    vi.stubEnv("MYCCUSAGE_AGENT_TYPES", "codex");
    const manager = new ConfigManager();
    manager.saveConfig({ ...manager.loadConfig()!, retryDelay: 2000 });

    expect(readFileConfig()).toMatchObject({ ...fileConfig, retryDelay: 2000 });
    expect(readFileSync(manager.getConfigPath(), "utf8")).not.toContain(
      "temporary-env-value",
    );
    if (process.platform !== "win32") {
      expect(statSync(manager.getConfigPath()).mode & 0o777).toBe(0o600);
    }
  });

  it("does not persist any environment overrides when explicitly creating a config", () => {
    vi.stubEnv("MYCCUSAGE_API_KEY", "env-key");
    vi.stubEnv("MYCCUSAGE_ENDPOINT", credentials.endpoint);
    vi.stubEnv("MYCCUSAGE_AGENT_TYPES", "codex");
    vi.stubEnv("MYCCUSAGE_DEVICE_ID", "env-id");
    vi.stubEnv("MYCCUSAGE_DEVICE_NAME", "env-host");
    vi.stubEnv("MYCCUSAGE_DISPLAY_NAME", "Env display");
    const manager = new ConfigManager();
    manager.saveConfig(manager.loadConfig()!);
    for (const field of Object.keys(CONFIG_ENV_VARS)) {
      expect(readFileConfig()).not.toHaveProperty(field);
    }
  });

  it("rejects unknown settings instead of silently ignoring them", () => {
    writeFileConfig({ ...credentials, extraSetting: true });
    expect(() => new ConfigManager().loadConfig()).toThrow(
      "Config supports only these fields",
    );
  });

  it("can resolve explicit inputs without using the process environment", () => {
    vi.stubEnv("MYCCUSAGE_API_KEY", "process-key");
    expect(resolveConfig(credentials, {})).toMatchObject(credentials);
  });
});
