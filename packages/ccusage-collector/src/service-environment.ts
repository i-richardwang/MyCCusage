import { readFileSync } from "fs";
import { isAbsolute } from "path";
import { CONFIG_ENV_VARS } from "./config.js";

const SERVICE_ENVIRONMENT_NAMES = new Set([
  ...Object.values(CONFIG_ENV_VARS),
  "PATH",
  "SHELL",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "OPENCODE_DATA_DIR",
  "ANTIGRAVITY_DATA_DIR",
  "DIMCODE_HOME",
  "MYCCUSAGE_CURSOR_DB",
  "CURSOR_STATE_DB_PATH",
  "CURSOR_CONFIG_DIR",
  "CURSOR_WEB_BASE_URL",
  "MYCCUSAGE_CURSOR_FETCH_TIMEOUT_MS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
]);

export function captureServiceEnvironment(
  home: string,
  source: NodeJS.ProcessEnv,
): Record<string, string> {
  const environment: Record<string, string> = { HOME: home };
  for (const name of SERVICE_ENVIRONMENT_NAMES) {
    const value = source[name];
    if (value?.trim()) environment[name] = value;
  }
  return environment;
}

export function loadServiceEnvironment(path: string): void {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(
      "Unable to read the service environment. Run ccusage-collector service install.",
    );
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("HOME" in value) ||
    typeof value.HOME !== "string" ||
    !isAbsolute(value.HOME) ||
    Object.entries(value).some(
      ([name, entry]) =>
        (name !== "HOME" && !SERVICE_ENVIRONMENT_NAMES.has(name)) ||
        typeof entry !== "string",
    )
  ) {
    throw new Error(
      "Invalid service environment. Run ccusage-collector service install.",
    );
  }
  // Start from the installation's explicit environment, not ambient manager overrides.
  for (const name of SERVICE_ENVIRONMENT_NAMES) delete process.env[name];
  Object.assign(process.env, value);
}
