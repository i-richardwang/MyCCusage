import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { existsSync, writeFileSync, chmodSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join } from "path";
import { fileURLToPath } from "url";
import { parseSchedule, type CalendarSchedule } from "./schedule.js";

const LABEL = "io.myccusage.collector";
const UNIT = "ccusage-collector";
const execFileAsync = promisify(execFile);

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ServiceContext {
  platform: NodeJS.Platform;
  home: string;
  uid: number;
  env: NodeJS.ProcessEnv;
  executable: string;
  entry: string;
  execute: (command: string, args: string[]) => Promise<CommandResult>;
}

async function execute(
  command: string,
  args: string[],
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 15_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof failure.code === "number" ? failure.code : -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "Command unavailable or timed out",
    };
  }
}

export function defaultServiceContext(): ServiceContext {
  return {
    platform: process.platform,
    home: homedir(),
    uid: process.getuid?.() ?? -1,
    env: process.env,
    executable: process.execPath,
    entry: fileURLToPath(new URL("./service-entry.js", import.meta.url)),
    execute,
  };
}

function xml(value: string): string {
  return value.replace(
    /[<>&"']/g,
    (char) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[char]!,
  );
}

function unitQuote(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/%/g, "%%");
  return `"${escaped.replace(/\$/g, "$$$$")}"`;
}

function calendarDictionaries(schedule: CalendarSchedule): string {
  let entries: Record<string, number>[] = [{}];
  const keys = {
    minute: "Minute",
    hour: "Hour",
    day: "Day",
    month: "Month",
    weekday: "Weekday",
  };
  for (const key of Object.keys(keys) as (keyof CalendarSchedule)[]) {
    if (schedule[key].length) {
      entries = entries.flatMap((entry) =>
        schedule[key].map((value) => ({ ...entry, [keys[key]]: value })),
      );
    }
  }
  // An empty dictionary means every minute, as in '* * * * *'.
  return entries
    .map(
      (entry) =>
        `<dict>${Object.entries(entry)
          .map(([key, value]) => `<key>${key}</key><integer>${value}</integer>`)
          .join("")}</dict>`,
    )
    .join("\n");
}

function calendarExpression(schedule: CalendarSchedule): string {
  const field = (values: number[]) => (values.length ? values.join(",") : "*");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekday = schedule.weekday.length
    ? schedule.weekday.map((day) => days[day]).join(",") + " "
    : "";
  return `${weekday}*-${field(schedule.month)}-${field(schedule.day)} ${field(schedule.hour)}:${field(schedule.minute)}:00`;
}

export interface SchedulerRegistration {
  active: boolean;
  enabled: boolean;
}

export interface SchedulerFile {
  path: string;
  content: string;
}

export class NativeScheduler {
  readonly name: "launchd" | "systemd";
  readonly files: string[];
  readonly logPath: string;

  constructor(readonly context: ServiceContext) {
    if (context.platform !== "darwin" && context.platform !== "linux") {
      throw new Error("Native scheduling supports macOS and Linux only.");
    }
    this.name = context.platform === "darwin" ? "launchd" : "systemd";
    this.logPath = join(
      context.home,
      ".ccusage-collector",
      "service",
      "sync.log",
    );
    const unitDirectory = join(
      context.env.XDG_CONFIG_HOME || join(context.home, ".config"),
      "systemd",
      "user",
    );
    this.files =
      this.name === "launchd"
        ? [join(context.home, "Library", "LaunchAgents", `${LABEL}.plist`)]
        : [
            join(unitDirectory, `${UNIT}.service`),
            join(unitDirectory, `${UNIT}.timer`),
          ];
    for (const path of [
      ...this.files,
      context.home,
      context.executable,
      context.entry,
    ]) {
      if (
        !isAbsolute(path) ||
        [...path].some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        )
      ) {
        throw new Error(
          "Service paths must be absolute and contain no control characters.",
        );
      }
    }
  }
  private get target(): string {
    return `gui/${this.context.uid}/${LABEL}`;
  }

  private async checked(
    command: string,
    args: string[],
  ): Promise<CommandResult> {
    const result = await this.context.execute(command, args);
    if (result.code !== 0) {
      throw new Error(
        `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout || `exit ${result.code}`}`,
      );
    }
    return result;
  }

  async checkAvailability(): Promise<void> {
    if (this.context.platform === "darwin") {
      await this.checked("launchctl", ["print", `gui/${this.context.uid}`]);
    } else {
      try {
        await this.checked("systemctl", ["--user", "show-environment"]);
      } catch {
        throw new Error(
          "A running systemd user manager is required. Use a user login session; containers without systemd should invoke ccusage-collector sync from their platform scheduler.",
        );
      }
    }
  }

  async status(): Promise<SchedulerRegistration> {
    if (this.context.platform === "darwin") {
      const result = await this.context.execute("launchctl", [
        "print",
        this.target,
      ]);
      const active = result.code === 0;
      if (
        !active &&
        !/could not find service/i.test(result.stderr + result.stdout)
      ) {
        throw new Error(
          `Unable to inspect LaunchAgent: ${result.stderr || result.stdout}`,
        );
      }
      const overrides = await this.checked("launchctl", [
        "print-disabled",
        `gui/${this.context.uid}`,
      ]);
      const disabled = overrides.stdout
        .split("\n")
        .some((line) => line.includes(`"${LABEL}"`) && /=>\s*true/.test(line));
      return {
        active,
        enabled: (active || existsSync(this.files[0]!)) && !disabled,
      };
    }
    const result = await this.context.execute("systemctl", [
      "--user",
      "show",
      `${UNIT}.timer`,
      "--property=LoadState,ActiveState,UnitFileState",
    ]);
    const properties = Object.fromEntries(
      result.stdout
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
    );
    if (properties.LoadState === "not-found")
      return { active: false, enabled: false };
    if (result.code !== 0 || !properties.LoadState || !properties.ActiveState)
      throw new Error(
        `Unable to inspect systemd timer: ${result.stderr || result.stdout}`,
      );
    return {
      active: properties.ActiveState === "active",
      enabled: properties.UnitFileState === "enabled",
    };
  }

  render(schedule: string, environmentPath: string): SchedulerFile[] {
    const calendar = parseSchedule(schedule);
    const args = [this.context.executable, this.context.entry, environmentPath];
    if (this.context.platform === "darwin") {
      const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array>${args.map((arg) => `<string>${xml(arg)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${xml(this.context.home)}</string>
<key>EnvironmentVariables</key><dict><key>HOME</key><string>${xml(this.context.home)}</string></dict>
<key>RunAtLoad</key><true/>
<key>StartCalendarInterval</key><array>${calendarDictionaries(calendar)}</array>
<key>StandardOutPath</key><string>${xml(this.logPath)}</string>
<key>StandardErrorPath</key><string>${xml(this.logPath)}</string>
</dict></plist>
`;
      return [{ path: this.files[0]!, content }];
    }
    return [
      {
        path: this.files[0]!,
        content: `[Unit]\nDescription=Sync coding agent usage to MyCCusage\n\n[Service]\nType=oneshot\nExecStart=${args.map((arg) => unitQuote(arg)).join(" ")}\nWorkingDirectory=~\nUMask=0077\nTimeoutStartSec=infinity\n`,
      },
      {
        path: this.files[1]!,
        content: `[Unit]\nDescription=Schedule MyCCusage sync\n\n[Timer]\nOnActiveSec=5s\nOnCalendar=${calendarExpression(calendar)}\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`,
      },
    ];
  }

  prepareLogs(): void {
    if (this.name === "launchd") {
      writeFileSync(this.logPath, "", { flag: "a", mode: 0o600 });
      chmodSync(this.logPath, 0o600);
    }
  }

  async activate(): Promise<void> {
    if (this.context.platform === "darwin") {
      await this.checked("launchctl", ["enable", this.target]);
      await this.checked("launchctl", [
        "bootstrap",
        `gui/${this.context.uid}`,
        this.files[0]!,
      ]);
    } else {
      await this.checked("systemctl", ["--user", "daemon-reload"]);
      await this.checked("systemctl", [
        "--user",
        "enable",
        "--now",
        `${UNIT}.timer`,
      ]);
    }
    const state = await this.status();
    if (!state.active || !state.enabled)
      throw new Error("The scheduler did not activate the collector task.");
  }

  async deactivate(): Promise<void> {
    const registration = await this.status();
    if (this.name === "launchd") {
      if (registration.enabled)
        await this.checked("launchctl", ["disable", this.target]);
      if (registration.active)
        await this.checked("launchctl", ["bootout", this.target]);
      return;
    }
    if (registration.active || registration.enabled) {
      await this.checked("systemctl", [
        "--user",
        "disable",
        "--now",
        `${UNIT}.timer`,
      ]);
    }
    if (existsSync(this.files[0]!))
      await this.checked("systemctl", ["--user", "stop", `${UNIT}.service`]);
  }

  async refresh(): Promise<void> {
    if (this.name === "systemd")
      await this.checked("systemctl", ["--user", "daemon-reload"]);
  }

  async restore(registration: SchedulerRegistration): Promise<void> {
    await this.refresh();
    if (this.name === "launchd") {
      if (registration.active) await this.activate();
      await this.checked("launchctl", [
        registration.enabled ? "enable" : "disable",
        this.target,
      ]);
      return;
    }
    if (registration.enabled)
      await this.checked("systemctl", ["--user", "enable", `${UNIT}.timer`]);
    if (registration.active)
      await this.checked("systemctl", ["--user", "start", `${UNIT}.timer`]);
  }
  async logs(follow: boolean): Promise<void> {
    const command = this.context.platform === "darwin" ? "tail" : "journalctl";
    const args =
      this.context.platform === "darwin"
        ? ["-n", "100", ...(follow ? ["-F"] : []), this.logPath]
        : [
            "--user",
            "-u",
            `${UNIT}.service`,
            "-n",
            "100",
            "--no-pager",
            ...(follow ? ["--follow"] : []),
          ];
    if (this.context.platform === "darwin" && !existsSync(this.logPath))
      throw new Error("No service log yet. Install the service first.");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", (code, signal) =>
        code === 0 || signal === "SIGINT"
          ? resolve()
          : reject(new Error(`${command} exited with ${code ?? signal}`)),
      );
    });
  }
}
