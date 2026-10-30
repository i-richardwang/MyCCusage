import { afterEach, describe, expect, it, vi } from "vitest";
import { hostname } from "os";
import { ConfigManager, resolveConfig } from "../src/config";
import { UsageCollector } from "../src/collector";
import { createCalendar } from "../src/calendar";
import { resolveDeviceIdentity } from "../src/utils/device-info";

vi.mock("../src/amp/index.js", () => ({
  collectAmpUsage: async () => ({ daily: [], totals: {} }),
}));
vi.mock("../src/dimagent.js", () => ({
  collectDimagentUsage: () => ({ daily: [], totals: {} }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("device identity", () => {
  it("fills missing fields independently without touching config", () => {
    const load = vi.spyOn(ConfigManager.prototype, "loadConfig");
    const save = vi.spyOn(ConfigManager.prototype, "saveConfig");
    expect(resolveDeviceIdentity({ deviceId: "fixed-id" })).toEqual({
      deviceId: "fixed-id",
      deviceName: hostname(),
      displayName: undefined,
    });
    expect(resolveDeviceIdentity({ deviceName: "custom-name" })).toMatchObject({
      deviceId: expect.stringMatching(/^[a-f0-9]{32}$/),
      deviceName: "custom-name",
    });
    expect(load).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("uses constructor inputs consistently and keeps each agent's metadata independent", async () => {
    const load = vi.spyOn(ConfigManager.prototype, "loadConfig");
    const save = vi.spyOn(ConfigManager.prototype, "saveConfig");
    vi.stubEnv("MYCCUSAGE_DEVICE_ID", "ambient-env-id");
    const options = {
      apiKey: "library-key",
      endpoint: "https://example.com/api/usage-sync",
      deviceId: "library-id",
      deviceName: "library-name",
      displayName: "Library device",
    };
    const config = resolveConfig(options, {})!;
    const collector = new UsageCollector(config);
    config.deviceId = "changed-after-construction";
    const calendar = createCalendar("UTC");
    const amp = await collector.collectUsageData("amp", calendar);
    const dimagent = await collector.collectUsageData("dimagent", calendar);
    expect(amp.device).toEqual({
      deviceId: "library-id",
      deviceName: "library-name",
      displayName: "Library device",
      agentType: "amp",
    });
    expect(dimagent.device).toEqual({ ...amp.device, agentType: "dimagent" });
    expect(amp.device.agentType).toBe("amp");
    expect(load).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it("reports run failures to its caller without terminating the process", async () => {
    const config = resolveConfig(
      { apiKey: "test-key", endpoint: "https://example.com/api/usage-sync" },
      {},
    )!;
    const collector = new UsageCollector(config);
    vi.spyOn(collector, "fetchCalendar").mockResolvedValue(
      createCalendar("UTC"),
    );
    vi.spyOn(collector, "collectUsageData").mockRejectedValue(
      new Error("Source unavailable"),
    );
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("Unexpected process exit");
    });
    await expect(collector.run()).rejects.toThrow(
      "No agents synced successfully",
    );
    expect(exit).not.toHaveBeenCalled();
  });
});
