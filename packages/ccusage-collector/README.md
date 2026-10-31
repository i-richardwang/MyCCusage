# ccusage-collector

A command-line tool for collecting coding agent usage statistics and syncing them to your self-hosted My Claude Code Usage Dashboard.

## Overview

Collect usage from selected coding agents, attach device identity, and sync daily records to your dashboard. Configure the collector through environment variables or an optional JSON file.

## Installation

Install globally with Bun (recommended):

```bash
bun add -g ccusage-collector
```

Or with npm:

```bash
npm install -g ccusage-collector
```

Or run one-off commands without installing:

```bash
bunx ccusage-collector config
bunx ccusage-collector sync
```

## Prerequisites

Deploy the [MyCCusage dashboard](../../README.md) and use its `API_KEY` when configuring the collector.

- Node.js ≥20 (Bun may be used to install the package)
- macOS with a logged-in graphical user session, or Linux with a running systemd user manager, for native scheduling
- `ccusage` CLI installed and available in PATH (OpenCode, Antigravity)
- `amp` CLI installed and logged in (AMP)
- At least one supported coding agent installed and configured
- Access to a deployed My Claude Code Usage Dashboard

## Quick Start

### 1. Interactive Configuration

```bash
ccusage-collector config
```

This will prompt you for:
- **API Key** (hidden input)
- **Sync Endpoint URL** (e.g., https://your-app.com/api/usage-sync)
- **Device Display Name** (optional, custom name for this device)
- **Sync Schedule** (user-friendly options like "Every 4 hours")

### 2. Start Background Sync

```bash
ccusage-collector service install
```

### 3. Check Status

```bash
ccusage-collector status
ccusage-collector service status
```

## Available Commands

| Command | Description |
|---------|-------------|
| `ccusage-collector config` | Interactive configuration wizard |
| `ccusage-collector service install` | Install or update native scheduled sync |
| `ccusage-collector service uninstall` | Remove scheduled sync and its saved environment |
| `ccusage-collector service status [--json]` | Inspect registration and the latest sync result |
| `ccusage-collector service logs [-f]` | Show the latest 100 log lines; optionally follow |
| `ccusage-collector sync` | Run single sync operation |
| `ccusage-collector sync --dry-run` | Test data collection without syncing |
| `ccusage-collector status` | Check configuration status |
| `ccusage-collector test` | Test configuration and connection |
| `ccusage-collector --help` | Show help |

## Configuration

Configuration resolves in this order: **nonblank environment variables → JSON configuration → defaults**. The optional JSON file is `~/.ccusage-collector/config.json`, written with user-only file permissions by the `config` wizard.

`sync`, `test`, `status`, and service management never create or modify this configuration file. Collection commands use a shared lock; sync records its outcome in `~/.ccusage-collector/sync-state.json`. Agent-specific caches (such as AMP exports and pricing) are separate.

The JSON object accepts `apiKey`, `endpoint`, `agentTypes`, `deviceId`, `deviceName`, `displayName`, `claudeConfigDirs`, `schedule`, `maxRetries`, and `retryDelay`. Unknown fields are rejected. Schedule labels are derived for display and are not stored.

### Environment Variables

Credentials, agent selection, device identity, and Claude Code data directories can all be supplied through the environment:

| Variable | JSON field | Default when not configured |
|---|---|---|
| `MYCCUSAGE_API_KEY` | `apiKey` | Required |
| `MYCCUSAGE_ENDPOINT` | `endpoint` | Required; full HTTP(S) URL including `/api/usage-sync` |
| `MYCCUSAGE_AGENT_TYPES` | `agentTypes` | `claude-code` |
| `MYCCUSAGE_DEVICE_ID` | `deviceId` | Fingerprint derived from hostname and MAC addresses |
| `MYCCUSAGE_DEVICE_NAME` | `deviceName` | Hostname |
| `MYCCUSAGE_DISPLAY_NAME` | `displayName` | Unset; the dashboard uses the device name |
| `MYCCUSAGE_CLAUDE_CONFIG_DIRS` | `claudeConfigDirs` | Unset; `CLAUDE_CONFIG_DIR`, else `~/.config/claude` and `~/.claude` |

`MYCCUSAGE_AGENT_TYPES` is a comma-separated list. Supported values are `claude-code`, `amp`, `opencode`, `codex`, `dimagent`, `cursor`, and `antigravity`. Whitespace is trimmed and duplicates are removed. Unknown agents and empty list entries are rejected with a configuration error before collection begins.

Blank environment values count as unset, so an empty export never shadows a valid file entry. Device fields resolve independently: setting only `MYCCUSAGE_DEVICE_ID` still defaults the device name to the hostname. Agent selection uses the JSON `agentTypes` array or the environment list. Schedule and retry settings use JSON values or their defaults (every four hours, three attempts, 1000 ms retry delay).

### Claude Code Data Directories

By default the collector reads Claude Code transcripts from the directories in `CLAUDE_CONFIG_DIR` (comma-separated), else from `~/.config/claude` and `~/.claude`. When Claude Code runs with other config directories (for example, separate accounts), list every directory to collect:

```json
{
  "claudeConfigDirs": ["~/.claude", "/path/to/another/claude/config"]
}
```

or `MYCCUSAGE_CLAUDE_CONFIG_DIRS='~/.claude,/path/to/another/claude/config'`. Each entry is an absolute path or starts with `~/`, and may be a Claude config directory or its `projects/` directory. The list replaces the default lookup, so include `~/.claude` when it should still be collected. Directories without a `projects/` folder are skipped and the rest are merged; requests present in several directories are counted once.

Claude Code itself reads `CLAUDE_CONFIG_DIR` to decide where it stores its configuration, so prefer `claudeConfigDirs` over exporting a comma-separated `CLAUDE_CONFIG_DIR` globally in shell profiles.

### Cloud / Sandbox VM: No JSON Required

Inject these variables into the process environment, then run:

```bash
export MYCCUSAGE_API_KEY='your-secret-api-key'
export MYCCUSAGE_ENDPOINT='https://your-app.com/api/usage-sync'
export MYCCUSAGE_AGENT_TYPES='claude-code,codex'
export MYCCUSAGE_DEVICE_ID='cloud-dev-01'
export MYCCUSAGE_DEVICE_NAME='cloud-dev-01'
export MYCCUSAGE_DISPLAY_NAME='Cloud development'

ccusage-collector status
ccusage-collector sync
```

No interactive setup or configuration file is needed. A platform scheduler can invoke `sync` periodically. On macOS or a Linux host with a systemd user manager, `service install` registers a native task and saves the supported environment overrides for future runs. The collector must have access to the selected agents' usage data and required CLIs in that environment. `.env` files are not loaded automatically; `.env.example` is a reference for your platform's environment injection.

Use a distinct device ID for each independent usage dataset. Reuse an ID across VM rebuilds only when the VM continues the same dataset: each sync replaces the days it reports for its device ID and agent, so independent VMs sharing an ID overwrite each other's usage rather than adding to it. Changing the display name does not change device identity.

The `config` wizard skips credential, agent-selection, and display-name questions supplied by the environment. When explicitly saving JSON, environment overrides are not persisted; existing file values for those fields are preserved. `status` shows resolved settings without printing the API key.

### Interactive Configuration

```bash
ccusage-collector config
```

**Sample Configuration Session:**
```
🔧 ccusage-collector Configuration Wizard
=========================================

? Select the coding agents to track: Claude Code
? Enter your API Key: ********** (hidden input)
? Enter the sync endpoint URL (including /api/usage-sync): https://myccusage.example.com/api/usage-sync
? Enter a device display name (optional): My MacBook Pro
? Select sync frequency: Every 4 hours

🧪 Testing data collection...
✅ Configuration saved successfully!

Run once: ccusage-collector sync
Install/update background sync: ccusage-collector service install
```

### Programmatic Configuration

`UsageCollector` consumes the options passed to its constructor. It does not implicitly load JSON or deployment environment variables. Use the same configuration boundary as the CLI when needed:

```ts
import { ConfigManager, UsageCollector } from "ccusage-collector";

const config = new ConfigManager().loadConfig();
if (!config) throw new Error("API key and endpoint are required");
await new UsageCollector(config).run();
```

Alternatively, `resolveConfig(rawSettings, env)` resolves an explicit settings object and environment without reading a file. `resolveDeviceIdentity(options)` fills missing device fields from the host without reading or writing configuration. `UsageCollector` requires complete runtime options; configuration defaults and validation belong to `resolveConfig`.

### Available Schedule Options

- Every 30 minutes
- Every 1 hour
- Every 2 hours
- Every 4 hours (recommended)
- Every 8 hours
- Once daily

## Data Collection

Days and hours follow the dashboard's account time zone (`USAGE_TIMEZONE` on the dashboard), not the collector machine's. Each run reads it from the endpoint before collecting, buckets every agent's usage in it (ccusage receives `--timezone`), and sends it with the upload; the dashboard rejects uploads bucketed in another zone. A date therefore means the same day on every device, wherever and however the collector runs.

The collector:
- Reads Claude Code and Codex transcripts itself and reports their usage per hour and model (see below)
- Uses explicit ccusage agent commands, `ccusage opencode daily --json` and `ccusage antigravity daily --json`, for OpenCode and Antigravity (Antigravity reads its local SQLite conversation databases; set `ANTIGRAVITY_DATA_DIR` when they live outside the default `~/.gemini/*` roots)
- Collects AMP through the `amp` CLI (see below)
- Parses DimAgent's local SQLite store (`~/.dimcode/v2/dimcode.sqlite`) directly; no ccusage support needed
- Pulls Cursor usage from the cloud CSV export via the local session token in Cursor's state DB; no ccusage support needed. The export is account-wide, so enable Cursor on exactly one device per account to avoid double-counting
- Reports Claude Code, Codex, DimAgent and Cursor per hour and model, since they record when each request ran; AMP (whose subagent usage is known per day), OpenCode and Antigravity per day and model
- Uploads all the history DimAgent, Cursor, AMP, OpenCode and Antigravity keep, and the recent days of Claude Code and Codex transcripts (see below)
- Generates unique device fingerprints for multi-device tracking
- Allows custom device names for better dashboard readability

### Claude Code and Codex

The collector parses each request recorded in the transcripts: Claude Code's `projects/` directories and Codex's `sessions/` and `archived_sessions/` under `CODEX_HOME` (default `~/.codex`). The parsers are adapted from [T3 Code](https://github.com/pingdotgg/t3code) (MIT).

- Claude Code repeats a message's usage on every content block; each request (`message.id` and `requestId`) counts once, across files and config directories. Advisor calls count under their own model
- Codex usage carries its model and service tier from earlier lines of the rollout. Cumulative counters validate each request, history copied into forked or subagent rollouts is skipped, and a session seen both live and archived counts once
- Each request is priced on its own at LiteLLM's rates: long-context rates when its prompt passes the model's threshold, one-hour cache writes at their own rate, Claude fast mode and US-only inference by their multipliers, and Codex priority and ultrafast tiers at their rates. A cost Claude Code recorded itself (`costUSD`) is used as is
- Reasoning tokens are reported where the agent records them (Codex, and Claude Code versions that report thinking tokens); they are part of output tokens
- Every sync re-reads the last 30 days, fewer when Claude Code's `cleanupPeriodDays` is shorter, so no day it sends has lost transcripts. The range starts at the first request found: a machine whose transcripts were wiped never erases days the dashboard already has. Older days keep what earlier syncs stored

### AMP

AMP stores threads server-side, so the collector reads them through the `amp` CLI:

- Lists this machine's threads with `amp threads list --json --installation-id <id>` (the id comes from `~/.local/share/amp/device-id.json`), so each device reports only its own threads
- Exports new or changed threads with `amp threads export`, keeping only per-message usage in `~/.ccusage-collector/amp-cache/`. Exports hold the main agent's usage only
- Fetches `amp threads usage <id> --details` for each active day to add subagent and side-call usage (Task, Read Thread, View Media, Finder, Librarian, compaction, Thread Title) per model. Reports are cached by the exact time range they cover, so a day only uses a report fetched for its range in the account time zone; after a time zone change, reports are fetched again
- Rebuilds daily totals from the cache on every run

Notes:

- AMP allows 60 usage reports per hour. The collector uses at most 40 per hour, newest days first, and pauses for an hour when AMP reports the limit. Until a day's report is fetched, that day counts the main agent only. A large backfill therefore spreads over several syncs at least an hour apart, and each sync uploads the completed days again
- Usage AMP ran through Claude Code (`external-agent:claude-code`) is skipped, because the collector already counts it under Claude Code
- Per-model input and output are exact. The report splits cache reads per thread-day only, so for subagent usage the cache-read share is estimated; main-agent usage keeps its exact split
- Cost is an API-equivalent estimate using LiteLLM's base input, output, cache-write and cache-read rates, including linked-provider usage. It is not AMP's actual charge. Prices are cached in `~/.ccusage-collector/pricing.json` for 24 hours; failed refreshes use the newest available cache or bundled snapshot
- Prices match exact model names and known provider/name-format variants, falling back to export/report aliases established by successful reconciliation. Unknown models, unsupported modalities (such as image generation), or missing rates for used token categories keep their tokens but contribute 0 cost, with a warning naming the unpriced models
- Estimates use base rates, without inferring long-context/fast surcharges or cache-write duration from daily totals. Subagent cache splits remain estimates as described above. Updated prices revalue cached history on subsequent syncs
- The usage report is formatted text. If its format changes, affected days fall back to the main agent only and the collector logs a warning

Maintainers can refresh the bundled price snapshot with `pnpm --filter ccusage-collector update-pricing` from the repository root.

### Data Format

Each upload holds one agent's usage on one device as buckets: an hour of the account calendar (Claude Code, Codex, DimAgent, Cursor) or a whole day (AMP, OpenCode, Antigravity, and Cursor rows the export dates without a time), per model. A bucket carries input tokens (excluding cache), output tokens (including reasoning), cache-write and cache-read tokens, reasoning tokens and request counts where known, and the cost. The upload replaces every stored bucket of that agent and device on the days it covers: its range for Claude Code and Codex, otherwise the days it reports.

Collector and dashboard each name the sync protocol they speak (currently 2); the collector checks the dashboard's before collecting, and either side rejects an upload in another protocol. Update the dashboard first, then the collectors.

## Error Handling

- **Network failures**: Automatic retry with exponential backoff
- **Authentication errors**: Immediate failure (no retry on 401/403)
- **Invalid uploads**: The dashboard rejects the whole upload, so a day is never left half replaced
- **Configuration errors**: Clear guidance on resolution
- **Detailed logging**: Clear error messages and debugging info

## Native Scheduled Sync

```bash
ccusage-collector config
ccusage-collector sync                 # Verify collection and upload
ccusage-collector service install      # Install or update one user-level task
ccusage-collector service status
ccusage-collector service logs -f
ccusage-collector service uninstall
```

The operating system starts a single sync and the process exits when it finishes. Installation is idempotent and verifies the scheduler is active and enabled; a failed update restores the previous files and registration. No administrator access is needed for task registration.

- **macOS:** `~/Library/LaunchAgents/io.myccusage.collector.plist`, loaded in the current user's graphical login domain. Runs when loaded and on the calendar schedule. Missed calendar events during sleep coalesce into one run on wake. Logging out stops the user agent; it loads again at the next graphical login.
- **Linux:** `ccusage-collector.service` and `ccusage-collector.timer` under `${XDG_CONFIG_HOME:-~/.config}/systemd/user/`. A oneshot service runs shortly after timer activation and on the calendar schedule. `Persistent=true` catches up missed calendar events when the timer activates. To run at boot and after logout, enable lingering for your account with `loginctl enable-linger` (subject to your system's permissions). Containers without a systemd user manager should use their platform's scheduler to invoke `sync`.

The saved `schedule` uses local wall-clock time. Custom schedules support five numeric cron fields, with wildcards, lists, ranges, and steps. For example, `15 2 * * *` runs at 02:15, and `0 */4 * * *` runs at 00:00, 04:00, and so on. Weekday constraints cannot be combined with day-of-month or month constraints because the native schedulers interpret these combinations differently. Seconds, named months/weekdays, parser extensions, and schedules expanding beyond 4096 calendar entries are rejected by configuration validation. DST transitions follow the native scheduler's calendar behavior.

Installation saves an allowlisted environment to `~/.ccusage-collector/service/environment.json` (file mode `0600`, service directory `0700`): collector configuration variables, PATH/SHELL, agent data-location overrides, proxy variables, and certificate paths. It does not copy unrelated environment variables. JSON configuration remains the source for fields without a saved environment override. Avoid scheduling from a temporary `bunx`/`npx` installation: install the collector globally so the task has a stable runtime and entry point.

**Re-run `service install` after changing the schedule, captured environment variables, Node installation, or collector installation path.** File-based credentials and agent settings are read on each sync. Installed schedule and registration are visible separately from configuration via `service status`; `service status --json` is suitable for scripts. `active` describes scheduler registration; `running` describes an ongoing collection operation. Status includes the latest manual or scheduled sync result, last complete success, and any failed agents. Partial failures exit nonzero while retaining successful uploads. An interrupted run is detected after its heartbeat lock expires (up to one minute).

All CLI collection operations share a heartbeat lock, including manual sync, dry-run, connection tests, and the configuration wizard's collection check. A concurrent manual operation reports that the collector is busy; an overlapping scheduled invocation skips successfully. Locks abandoned after a crash are recoverable. Configuration and sync history remain after uninstall; the saved service environment, including captured credentials, is removed.

`service logs` reads the macOS log at `~/.ccusage-collector/service/sync.log` or the Linux user journal. Manual sync logs remain in the terminal. The macOS log is append-only; manage its retention with your host's log rotation policy. Linux log retention follows journald settings.

For development, build the package and manage the task through `node packages/ccusage-collector/dist/cli.js service ...`. Native tasks always execute the built entry point, never a TypeScript development loader.

## Troubleshooting

### Common Issues

**❌ Configuration not found**
```bash
# Run interactive configuration
ccusage-collector config
```

**❌ "ccusage command not found"**
- Ensure the `ccusage` CLI is installed and in PATH
- Run `ccusage --help` to verify installation

**❌ "Authentication failed"**
- Run `ccusage-collector config` to update credentials
- Verify API key matches your dashboard configuration

**❌ "Connection refused"**
- Check endpoint URL in configuration
- Verify your dashboard is running and accessible

### Debug and Test

```bash
# Check configuration
ccusage-collector status

# Test configuration and connection
ccusage-collector test

# Test data collection only
ccusage-collector sync --dry-run

# View detailed logs
ccusage-collector service logs
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Development

```bash
# Clone the main repository
git clone https://github.com/i-richardwang/MyCCusage.git
cd MyCCusage/packages/ccusage-collector

# Install dependencies
pnpm install

# Build the package
pnpm build

# Test CLI locally
pnpm cli --help
pnpm cli config
pnpm cli status

# Run type checking
pnpm typecheck

# Run linting
pnpm lint
```

## Release

Publishing is automated: pushing a `collector-v*` tag runs the
`Publish collector` workflow, which verifies the tag matches
`package.json`, runs typecheck/lint/test/build, and publishes to npm
(requires the `NPM_TOKEN` secret in repo settings).

```bash
# 1. Bump the version
#    packages/ccusage-collector/package.json
# 2. Commit and push to main
# 3. Tag and push the tag
 git tag collector-v0.5.7
 git push origin collector-v0.5.7
```

To retry a failed publish: `gh workflow run publish-collector.yml --ref collector-v0.5.7`.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Related Projects

- [My Claude Code Usage Dashboard](https://github.com/i-richardwang/MyCCusage) - The main dashboard application
- [Claude Code](https://claude.ai/code) - The AI-powered coding assistant

## Support

- 🐛 [Report bugs](https://github.com/i-richardwang/MyCCusage/issues)
- 💡 [Request features](https://github.com/i-richardwang/MyCCusage/issues)
- 📚 [Documentation](https://github.com/i-richardwang/MyCCusage/blob/main/README.md)
