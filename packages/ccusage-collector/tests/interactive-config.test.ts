import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { hostname, tmpdir } from "os";
import { join } from "path";
import inquirer from "inquirer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_ENV_VARS } from "../src/config";
import { UsageCollector } from "../src/collector";
import { InteractiveConfig } from "../src/interactive-config";

vi.mock("inquirer", () => ({ default: { prompt: vi.fn() } }));
vi.mock("../src/collector.js", () => ({ UsageCollector: vi.fn() }));

describe("configuration wizard", () => {
  let home: string;
  const prompt = vi.mocked(inquirer.prompt);

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "myccusage-wizard-test-"));
    vi.stubEnv("HOME", home);
    for (const name of Object.values(CONFIG_ENV_VARS)) vi.stubEnv(name, "");
    vi.mocked(UsageCollector).mockImplementation(
      () =>
        ({
          collectAllUsageData: async () => [
            { device: { agentType: "codex" }, daily: [] },
          ],
        }) as unknown as UsageCollector,
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    rmSync(home, { recursive: true, force: true });
  });

  it("respects env agents and device settings even when credentials are prompted", async () => {
    vi.stubEnv("MYCCUSAGE_AGENT_TYPES", "codex");
    vi.stubEnv("MYCCUSAGE_DEVICE_ID", "cloud-id");
    vi.stubEnv("MYCCUSAGE_DISPLAY_NAME", "Cloud display");
    prompt.mockResolvedValueOnce({
      apiKey: "wizard-key",
      endpoint: "https://example.com/api/usage-sync",
      schedule: "0 */4 * * *",
    });
    await new InteractiveConfig().runConfigurationWizard();

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "displayName", when: false }),
      ]),
    );
    expect(UsageCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        agentTypes: ["codex"],
        deviceId: "cloud-id",
        deviceName: hostname(),
        displayName: "Cloud display",
      }),
    );
    const saved = JSON.parse(
      readFileSync(join(home, ".ccusage-collector/config.json"), "utf8"),
    );
    expect(saved).toMatchObject({
      apiKey: "wizard-key",
      endpoint: "https://example.com/api/usage-sync",
      deviceName: hostname(),
    });
    expect(saved).not.toHaveProperty("agentTypes");
    expect(saved).not.toHaveProperty("deviceId");
    expect(saved).not.toHaveProperty("displayName");
  });

  it("uses confirmed settings for collection and persistence", async () => {
    const dir = join(home, ".ccusage-collector");
    mkdirSync(dir);
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        apiKey: "file-key",
        endpoint: "https://old.example.com/api/usage-sync",
        deviceId: "saved-id",
        deviceName: "saved-host",
        displayName: "Old display",
        retryDelay: 0,
      }),
    );
    prompt.mockResolvedValueOnce({ shouldReconfigure: true });
    prompt.mockResolvedValueOnce({
      apiKey: "new-key",
      agentTypes: ["codex"],
      endpoint: "https://new.example.com/api/usage-sync",
      displayName: "New display",
      schedule: "0 * * * *",
    });
    await new InteractiveConfig().runConfigurationWizard();

    expect(UsageCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "new-key",
        deviceId: "saved-id",
        deviceName: "saved-host",
        displayName: "New display",
      }),
    );
    const saved = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    expect(saved).toMatchObject({
      apiKey: "new-key",
      deviceId: "saved-id",
      displayName: "New display",
      agentTypes: ["codex"],
      retryDelay: 0,
    });
  });

  it("preserves device identity and retry settings while completing missing credentials", async () => {
    const dir = join(home, ".ccusage-collector");
    mkdirSync(dir);
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        deviceId: "saved-id",
        deviceName: "saved-host",
        maxRetries: 5,
        retryDelay: 0,
      }),
    );
    prompt.mockResolvedValueOnce({
      apiKey: "wizard-key",
      endpoint: "https://example.com/api/usage-sync",
      agentTypes: ["codex"],
      schedule: "0 */4 * * *",
      displayName: "",
    });
    await new InteractiveConfig().runConfigurationWizard();
    expect(UsageCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "saved-id",
        deviceName: "saved-host",
        maxRetries: 5,
        retryDelay: 0,
      }),
    );
    const saved = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    expect(saved).toMatchObject({
      deviceId: "saved-id",
      maxRetries: 5,
      retryDelay: 0,
    });
  });

  it("leaves env-only configuration on disk untouched when reconfiguration is declined", async () => {
    vi.stubEnv("MYCCUSAGE_API_KEY", "env-key");
    vi.stubEnv("MYCCUSAGE_ENDPOINT", "https://example.com/api/usage-sync");
    prompt.mockResolvedValueOnce({ shouldReconfigure: false });
    await new InteractiveConfig().runConfigurationWizard();
    expect(UsageCollector).not.toHaveBeenCalled();
    expect(existsSync(join(home, ".ccusage-collector"))).toBe(false);
  });
});
