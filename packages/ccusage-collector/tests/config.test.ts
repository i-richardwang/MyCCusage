import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigManager } from "../src/config";

const ENV_KEYS = ["MYCCUSAGE_API_KEY", "MYCCUSAGE_ENDPOINT", "HOME"] as const;

function setEnv(name: (typeof ENV_KEYS)[number], value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("ConfigManager environment overrides", () => {
  let home: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "myccusage-config-test-"));
    savedEnv = {};
    for (const key of ENV_KEYS) {
        savedEnv[key] = process.env[key];
    }
    setEnv("HOME", home);
    setEnv("MYCCUSAGE_API_KEY", undefined);
    setEnv("MYCCUSAGE_ENDPOINT", undefined);
    vi.spyOn(process, "cwd").mockReturnValue(home);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      setEnv(key, savedEnv[key]);
    }
    vi.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
  });

  function writeFileConfig(config: Record<string, unknown>) {
    const dir = join(home, ".ccusage-collector");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  }

  function readFileConfig(): Record<string, unknown> {
    return JSON.parse(
      readFileSync(join(home, ".ccusage-collector", "config.json"), "utf8"),
    );
  }

  it("prefers file values when no environment overrides are set", () => {
    writeFileConfig({
      apiKey: "file-key",
      endpoint: "https://file.example.com/api/usage-sync",
      agentTypes: ["dimagent"],
    });

    const config = new ConfigManager().loadConfig();

    expect(config).toMatchObject({
      apiKey: "file-key",
      endpoint: "https://file.example.com/api/usage-sync",
      agentTypes: ["dimagent"],
    });
  });

  it("lets environment override file values", () => {
    writeFileConfig({
      apiKey: "file-key",
      endpoint: "https://file.example.com/api/usage-sync",
    });
    setEnv("MYCCUSAGE_API_KEY", "env-key");
    setEnv("MYCCUSAGE_ENDPOINT", "https://env.example.com/api/usage-sync");

    const config = new ConfigManager().loadConfig();

    expect(config).toMatchObject({
      apiKey: "env-key",
      endpoint: "https://env.example.com/api/usage-sync",
    });
    expect(new ConfigManager().getEnvOverrideStatus()).toEqual({
      apiKeyFromEnv: true,
      endpointFromEnv: true,
    });
  });

  it("treats blank environment values as unset", () => {
    writeFileConfig({
      apiKey: "file-key",
      endpoint: "https://file.example.com/api/usage-sync",
    });
    setEnv("MYCCUSAGE_API_KEY", "   ");
    setEnv("MYCCUSAGE_ENDPOINT", "");

    const config = new ConfigManager().loadConfig();

    expect(config).toMatchObject({
      apiKey: "file-key",
      endpoint: "https://file.example.com/api/usage-sync",
    });
    expect(new ConfigManager().getEnvOverrideStatus()).toEqual({
      apiKeyFromEnv: false,
      endpointFromEnv: false,
    });
  });

  it("works with no config file when the environment supplies credentials", () => {
    setEnv("MYCCUSAGE_API_KEY", "env-key");
    setEnv("MYCCUSAGE_ENDPOINT", "https://env.example.com/api/usage-sync");

    const config = new ConfigManager().loadConfig();

    expect(config).toMatchObject({
      apiKey: "env-key",
      endpoint: "https://env.example.com/api/usage-sync",
      agentTypes: ["claude-code"],
    });
  });

  it("returns null when neither file nor environment provides credentials", () => {
    setEnv("MYCCUSAGE_API_KEY", "env-key");

    expect(new ConfigManager().loadConfig()).toBeNull();
  });

  it("never writes environment-supplied credentials back to the file", () => {
    writeFileConfig({
      apiKey: "file-key",
      endpoint: "https://file.example.com/api/usage-sync",
    });
    setEnv("MYCCUSAGE_API_KEY", "env-key");
    setEnv("MYCCUSAGE_ENDPOINT", "https://env.example.com/api/usage-sync");

    const manager = new ConfigManager();
    const config = manager.loadConfig();
    expect(config).not.toBeNull();
    manager.saveConfig({ ...config!, displayName: "test-device" });

    // The file keeps only file-sourced fields; env secrets stay out.
    expect(readFileConfig()).toMatchObject({
      displayName: "test-device",
    });
    expect(readFileConfig()).not.toHaveProperty("apiKey");
    expect(readFileConfig()).not.toHaveProperty("endpoint");
  });
});
