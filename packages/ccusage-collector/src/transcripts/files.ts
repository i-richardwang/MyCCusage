import { createReadStream, realpathSync, statSync, type Dirent } from "fs";
import { readdir, stat } from "fs/promises";
import { homedir } from "os";
import { join, resolve } from "path";
import { createInterface } from "readline";

export function expandHome(dir: string): string {
  return dir === "~" || dir.startsWith("~/")
    ? join(homedir(), dir.slice(1))
    : dir;
}

// The canonical path of an existing directory; null for anything else
export function realDirectory(path: string): string | null {
  try {
    const canonical = realpathSync(resolve(expandHome(path)));
    return statSync(canonical).isDirectory() ? canonical : null;
  } catch {
    return null;
  }
}

/**
 * The existing directories among `entries` in canonical form, each once.
 * Configured entries must exist; missing defaults are skipped.
 */
export function existingDirs(
  entries: readonly string[],
  configured: boolean,
  agent: string,
): string[] {
  const dirs: string[] = [];
  for (const entry of entries) {
    const dir = realDirectory(entry);
    if (dir === null) {
      if (configured)
        throw new Error(`Cannot read configured ${agent} directory: ${entry}`);
      continue;
    }
    if (!dirs.includes(dir)) dirs.push(dir);
  }
  return dirs;
}

// Every .jsonl file under `root` written at or after `sinceMs`. A transcript
// holds no usage newer than its last write, so older files are skipped
// without being read. Directory failures abort the scan: an incomplete source
// cannot safely replace stored days.
export async function listTranscriptFiles(
  root: string,
  sinceMs: number,
): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries: Dirent[] = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          const { mtimeMs } = await stat(path);
          if (mtimeMs >= sinceMs) files.push(path);
        } catch (error) {
          // Agents delete and rotate transcripts while they run
          if (!isMissing(error)) throw error;
        }
      }
    }
  };
  await walk(root);
  return files.sort((a, b) => a.localeCompare(b));
}

export async function* readLines(path: string): AsyncGenerator<string> {
  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of lines) {
      if (line.length > 0) yield line;
    }
  } finally {
    lines.close();
  }
}

export function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
