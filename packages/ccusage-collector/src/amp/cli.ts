import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { delimiter, join } from "path";

// Runs `amp <args>` and resolves with stdout
export type AmpRunner = (args: string[], timeoutMs: number) => Promise<string>;

// Resolve the Amp CLI: PATH first, then the standalone installer locations
// (System schedulers often run with a PATH that lacks ~/.local/bin).
export function findAmpBinary(): string | null {
  const names = process.platform === "win32" ? ["amp.exe", "amp.cmd"] : ["amp"];
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const pathDirs = (process.env.PATH || "").split(delimiter).filter(Boolean);
  const home = homedir();
  const dirs = [
    ...pathDirs,
    join(home, ".local", "bin"),
    join(home, ".amp", "bin"),
    join(home, ".local", "share", "amp", "bin"),
  ];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function createAmpRunner(binary: string): AmpRunner {
  return (args, timeoutMs) =>
    new Promise((resolve, reject) => {
      // A logged-out CLI must fail instead of waiting on an interactive prompt
      const child = spawn(binary, args, {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("error", reject);
      child.on("close", (code, signal) => {
        if (code === 0) {
          resolve(Buffer.concat(stdout).toString("utf8"));
          return;
        }
        const detail =
          Buffer.concat(stderr)
            .toString("utf8")
            .split("\n")
            .map((line) => line.trim())
            .find(Boolean) || (signal ? `killed by ${signal}` : "no error output");
        reject(new Error(`\`amp ${args.join(" ")}\` failed: ${detail}`));
      });
    });
}

// The installation id scopes `amp threads list` to this machine; without it
// the list is account-wide and every device would report the same threads.
export function readAmpInstallationId(): string | null {
  const file = join(homedir(), ".local", "share", "amp", "device-id.json");
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return typeof data.installationID === "string" && data.installationID
      ? data.installationID
      : null;
  } catch {
    return null;
  }
}
