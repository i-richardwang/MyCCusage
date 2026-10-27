import { execFileSync } from "child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfig, SCHEDULE_OPTIONS } from "../src/config";
import { CollectorService } from "../src/service";
import type { ServiceContext, CommandResult } from "../src/native-scheduler";
import { parseSchedule } from "../src/schedule";

const config = resolveConfig(
  { apiKey: "test-key", endpoint: "https://example.com/api/usage-sync" },
  {},
)!;

describe.each(["darwin", "linux"] as const)(
  "native service (%s)",
  (platform) => {
    let home: string;
    let service: CollectorService;
    let active: boolean;
    let enabled: boolean;
    let failActivation: boolean;
    let unavailable: boolean;
    let commands: string[][];

    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), "myccusage-service-"));
      const entry = join(home, 'collector $test %20 & "entry.js');
      writeFileSync(entry, "// fixture\n");
      active = enabled = failActivation = unavailable = false;
      commands = [];
      const context: ServiceContext = {
        platform,
        home,
        uid: 501,
        env: {
          HOME: home,
          PATH: "/custom/bin:/usr/bin",
          MYCCUSAGE_API_KEY: 'secret % $ "\nkey',
          UNRELATED_SECRET: "do-not-copy",
          CODEX_HOME: "/custom/codex",
        },
        executable: process.execPath,
        entry,
        execute: async (command, args): Promise<CommandResult> => {
          commands.push([command, ...args]);
          if (unavailable)
            return { code: 1, stdout: "", stderr: "Failed to connect to bus" };
          if (
            args.includes("bootstrap") ||
            (args.includes("enable") && args.includes("--now"))
          ) {
            if (failActivation) {
              failActivation = false;
              return { code: 1, stdout: "", stderr: "activation failed" };
            }
            active = enabled = true;
          }
          if (args.includes("bootout")) active = false;
          if (args.includes("disable")) {
            enabled = false;
            if (platform === "linux") active = false;
          }
          if (args.includes("start")) active = true;
          if (args.includes("enable")) enabled = true;
          if (args.includes("print-disabled"))
            return {
              code: 0,
              stdout: `"io.myccusage.collector" => ${!enabled}`,
              stderr: "",
            };
          if (
            command === "launchctl" &&
            args[0] === "print" &&
            args[1]?.includes("io.myccusage.collector") &&
            !active
          ) {
            return {
              code: 113,
              stdout: "",
              stderr:
                'Could not find service "io.myccusage.collector" in domain for user gui: 501',
            };
          }
          const stdout = args.includes("show")
            ? `LoadState=loaded\nActiveState=${active ? "active" : "inactive"}\nUnitFileState=${enabled ? "enabled" : "disabled"}\n`
            : "";
          return { code: 0, stdout, stderr: "" };
        },
      };
      service = new CollectorService(context);
    });

    afterEach(() => rmSync(home, { recursive: true, force: true }));

    it("installs a verified user task with only explicit, protected environment values", async () => {
      await service.install(config);
      expect(await service.status()).toMatchObject({
        installed: true,
        active: true,
        enabled: true,
        pathsValid: true,
        schedule: config.schedule,
      });
      expect(JSON.parse(readFileSync(service.environmentPath, "utf8"))).toEqual(
        {
          HOME: home,
          PATH: "/custom/bin:/usr/bin",
          MYCCUSAGE_API_KEY: 'secret % $ "\nkey',
          CODEX_HOME: "/custom/codex",
        },
      );
      expect(statSync(service.environmentPath).mode & 0o777).toBe(0o600);
      expect(statSync(service.directory).mode & 0o777).toBe(0o700);
      for (const file of service.scheduler.files)
        expect(readFileSync(file, "utf8")).not.toContain("secret");
      expect(
        commands.some(
          (command) =>
            command.includes("--user") || command.includes("gui/501"),
        ),
      ).toBe(true);
    });

    it("updates one task in place, then uninstalls idempotently without removing user data", async () => {
      await service.install(config);
      await service.install({ ...config, schedule: "15 2 * * *" });
      expect((await service.status()).schedule).toBe("15 2 * * *");
      const configPath = join(home, ".ccusage-collector", "config.json");
      writeFileSync(configPath, "user settings");
      await service.uninstall();
      await service.uninstall();
      expect(await service.status()).toMatchObject({
        installed: false,
        active: false,
        enabled: false,
      });
      expect(existsSync(service.environmentPath)).toBe(false);
      expect(service.scheduler.files.every((file) => !existsSync(file))).toBe(
        true,
      );
      expect(readFileSync(configPath, "utf8")).toBe("user settings");
    });

    it("rolls back a failed first install", async () => {
      failActivation = true;
      await expect(service.install(config)).rejects.toThrow(
        "activation failed",
      );
      expect(existsSync(service.environmentPath)).toBe(false);
      expect(existsSync(service.installationPath)).toBe(false);
      expect(service.scheduler.files.every((file) => !existsSync(file))).toBe(
        true,
      );
      expect(active).toBe(false);
    });

    it("restores the previous working task and environment after a failed update", async () => {
      await service.install(config);
      const original = service.scheduler.files.map((file) =>
        readFileSync(file, "utf8"),
      );
      const environment = readFileSync(service.environmentPath, "utf8");
      service.context.env.MYCCUSAGE_API_KEY = "changed-key";
      failActivation = true;
      await expect(
        service.install({ ...config, schedule: "0 0 * * *" }),
      ).rejects.toThrow("activation failed");
      expect(
        service.scheduler.files.map((file) => readFileSync(file, "utf8")),
      ).toEqual(original);
      expect(readFileSync(service.environmentPath, "utf8")).toBe(environment);
      expect(await service.status()).toMatchObject({
        active: true,
        enabled: true,
        schedule: config.schedule,
      });
    });

    it("reports an unavailable user session and preserves an existing installation", async () => {
      await service.install(config);
      unavailable = true;
      await expect(service.uninstall()).rejects.toThrow();
      expect(existsSync(service.installationPath)).toBe(true);
      expect(existsSync(service.environmentPath)).toBe(true);
    });

    it("reports active and enabled independently and restores both after a failed update", async () => {
      await service.install(config);
      enabled = false;
      expect(await service.status()).toMatchObject({
        active: true,
        enabled: false,
      });
      failActivation = true;
      await expect(service.install(config)).rejects.toThrow(
        "activation failed",
      );
      expect(await service.status()).toMatchObject({
        active: true,
        enabled: false,
      });
    });

    it("stops scheduled work before changing the service environment", async () => {
      await service.install(config);
      commands = [];
      await service.install(config);
      const stop = commands.findIndex((args) =>
        platform === "darwin"
          ? args.includes("bootout")
          : args.includes("stop") && args.includes("ccusage-collector.service"),
      );
      const start = commands.findIndex((args) =>
        platform === "darwin"
          ? args.includes("bootstrap")
          : args.includes("enable") && args.includes("--now"),
      );
      expect(stop).toBeGreaterThanOrEqual(0);
      expect(start).toBeGreaterThan(stop);
    });

    it("uses native calendar scheduling, stable paths and no shell invocation", () => {
      const files = service.scheduler.render(
        "15 2 * * *",
        service.environmentPath,
      );
      if (platform === "darwin") {
        expect(files[0]?.content).toContain("StartCalendarInterval");
        expect(files[0]?.content).toContain(
          "<key>Minute</key><integer>15</integer>",
        );
        expect(files[0]?.content).toContain("&amp; &quot;entry.js");
        if (process.platform === "darwin") {
          const path = join(home, "fixture.plist");
          writeFileSync(path, files[0]!.content);
          execFileSync("plutil", ["-lint", path]);
        }
      } else {
        expect(files[0]?.content).toContain("Type=oneshot");
        expect(files[0]?.content).toContain('$$test %%20 & \\"entry.js');
        expect(files[1]?.content).toContain("OnCalendar=*-*-* 2:15:00");
        expect(files[1]?.content).toContain("Persistent=true");
      }
      expect(files.map(({ content }) => content).join("\n")).not.toContain(
        "/bin/sh",
      );
    });

    it("renders every configured schedule and supports weekday calendars", () => {
      for (const { value } of SCHEDULE_OPTIONS)
        expect(
          service.scheduler.render(value, service.environmentPath),
        ).toHaveLength(platform === "darwin" ? 1 : 2);
      const files = service.scheduler.render(
        "0 8 * * 1-5",
        service.environmentPath,
      );
      if (platform === "linux")
        expect(files[1]?.content).toContain(
          "OnCalendar=Mon,Tue,Wed,Thu,Fri *-*-* 8:0:00",
        );
      else {
        expect(files[0]?.content).toContain(
          "<key>Weekday</key><integer>5</integer>",
        );
      }
    });

    it.runIf(process.platform === "linux" && platform === "linux")(
      "passes the native systemd unit and calendar parsers",
      () => {
        const [unit, timer] = service.scheduler.render(
          "0 */4 * * *",
          service.environmentPath,
        );
        const unitPath = join(home, "ccusage-collector.service");
        const timerPath = join(home, "ccusage-collector.timer");
        writeFileSync(unitPath, unit!.content);
        writeFileSync(timerPath, timer!.content);
        execFileSync("systemd-analyze", [
          "verify",
          "--man=no",
          unitPath,
          timerPath,
        ]);
        execFileSync("systemd-analyze", [
          "calendar",
          "Mon,Tue,Wed,Thu,Fri *-*-* 8:0:00",
        ]);
      },
    );

    it("honors XDG_CONFIG_HOME for Linux units", () => {
      if (platform !== "linux") return;
      const custom = new CollectorService({
        ...service.context,
        env: { XDG_CONFIG_HOME: join(home, "custom") },
      });
      expect(custom.scheduler.files[0]).toBe(
        join(home, "custom/systemd/user/ccusage-collector.service"),
      );
    });
  },
);

it.each([
  "0 0 0 * * *",
  "@daily",
  "0 0 L * *",
  "H * * * *",
  "0 0 * * MON",
  "99 * * * *",
  "0 8 1 * 1-5",
  "0 8 * 1 1-5",
])("rejects non-portable schedules: %s", (schedule) => {
  expect(() => parseSchedule(schedule)).toThrow();
});

it("normalizes Sunday aliases and full ranges", () => {
  expect(parseSchedule("0 */4 * * 7")).toEqual({
    minute: [0],
    hour: [0, 4, 8, 12, 16, 20],
    day: [],
    month: [],
    weekday: [0],
  });
  expect(parseSchedule("* * * * *")).toEqual({
    minute: [],
    hour: [],
    day: [],
    month: [],
    weekday: [],
  });
});

it("rejects unsupported operating systems", () => {
  expect(
    () => new CollectorService({ platform: "win32" } as ServiceContext),
  ).toThrow("macOS and Linux only");
});
