import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  chmodSync,
} from "fs";
import { dirname, join } from "path";
import type { Config } from "./config.js";
import {
  acquireLock,
  readJSON,
  writePrivateJSON,
  syncIsRunning,
  type SyncState,
} from "./runtime-state.js";
import {
  NativeScheduler,
  defaultServiceContext,
  type ServiceContext,
} from "./native-scheduler.js";
import { captureServiceEnvironment } from "./service-environment.js";

interface ServiceInstallation {
  schedule: string;
  executable: string;
  entry: string;
}

/** Owns installation files and transactions; the scheduler owns OS operations. */
export class CollectorService {
  readonly scheduler: NativeScheduler;
  readonly directory: string;
  readonly environmentPath: string;
  readonly installationPath: string;

  constructor(readonly context: ServiceContext = defaultServiceContext()) {
    this.scheduler = new NativeScheduler(context);
    this.directory = join(context.home, ".ccusage-collector", "service");
    this.environmentPath = join(this.directory, "environment.json");
    this.installationPath = join(this.directory, "installation.json");
  }

  async install(config: Config): Promise<void> {
    const files = this.scheduler.render(config.schedule, this.environmentPath);
    if (
      !existsSync(this.context.entry) ||
      !existsSync(this.context.executable)
    ) {
      throw new Error(
        "Install a built collector package before registering the service (run pnpm --filter ccusage-collector build for a source checkout).",
      );
    }
    const release = await acquireLock("service", dirname(this.directory));
    try {
      await this.scheduler.checkAvailability();
      const previous = await this.scheduler.status();
      const paths = [
        ...this.scheduler.files,
        this.environmentPath,
        this.installationPath,
      ];
      const snapshots = paths.map((path) => ({
        path,
        data: existsSync(path) ? readFileSync(path) : undefined,
      }));
      try {
        await this.scheduler.deactivate();
        mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        chmodSync(this.directory, 0o700);
        writePrivateJSON(
          this.environmentPath,
          captureServiceEnvironment(this.context.home, this.context.env),
        );
        this.scheduler.prepareLogs();
        for (const { path, content } of files) {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, content, { mode: 0o600 });
          chmodSync(path, 0o600);
        }
        await this.scheduler.activate();
        writePrivateJSON(this.installationPath, {
          schedule: config.schedule,
          executable: this.context.executable,
          entry: this.context.entry,
        } satisfies ServiceInstallation);
      } catch (error) {
        // Restore the previous registration and protected files on a failed update.
        const failures: string[] = [];
        try {
          await this.scheduler.deactivate();
        } catch {
          failures.push("deactivate new task");
        }
        for (const snapshot of snapshots) {
          try {
            if (snapshot.data)
              writeFileSync(snapshot.path, snapshot.data, { mode: 0o600 });
            else rmSync(snapshot.path, { force: true });
          } catch {
            failures.push(`restore ${snapshot.path}`);
          }
        }
        try {
          await this.scheduler.restore(previous);
        } catch {
          failures.push("restore previous registration");
        }
        throw new Error(
          `${error instanceof Error ? error.message : "Installation failed"}${failures.length ? `. Rollback could not ${failures.join(", ")}. Reinstall the service to repair it.` : ". Previous files and registration restored."}`,
        );
      }
    } finally {
      await release();
    }
  }

  async uninstall(): Promise<void> {
    const release = await acquireLock("service", dirname(this.directory));
    try {
      const installed =
        existsSync(this.installationPath) ||
        existsSync(this.environmentPath) ||
        this.scheduler.files.some((path) => existsSync(path));
      if (!installed) return;
      await this.scheduler.checkAvailability();
      await this.scheduler.deactivate();
      const remaining = await this.scheduler.status();
      if (remaining.active || remaining.enabled)
        throw new Error(
          "The scheduler still has an active registration; service files were preserved.",
        );
      for (const path of [
        ...this.scheduler.files,
        this.environmentPath,
        this.installationPath,
      ])
        rmSync(path, { force: true });
      await this.scheduler.refresh();
    } finally {
      await release();
    }
  }

  async status() {
    const installation = readJSON<ServiceInstallation>(this.installationPath);
    let registration = { active: false, enabled: false };
    // Inspect the real scheduler even when the manifest is missing.
    if (installation || this.scheduler.files.some((path) => existsSync(path))) {
      await this.scheduler.checkAvailability();
      registration = await this.scheduler.status();
    }
    const lastSync = readJSON<SyncState>(
      join(dirname(this.directory), "sync-state.json"),
    );
    const running = await syncIsRunning(dirname(this.directory));
    if (lastSync?.result === "running" && !running)
      lastSync.result = "interrupted";
    return {
      backend: this.scheduler.name,
      installed: Boolean(installation),
      ...registration,
      schedule: installation?.schedule,
      pathsValid: installation
        ? existsSync(installation.executable) &&
          existsSync(installation.entry) &&
          existsSync(this.environmentPath) &&
          this.scheduler.files.every((path) => existsSync(path))
        : false,
      running,
      lastSync,
    };
  }

  logs(follow: boolean): Promise<void> {
    return this.scheduler.logs(follow);
  }
}
