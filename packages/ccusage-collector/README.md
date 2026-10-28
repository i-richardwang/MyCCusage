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
- `ccusage` CLI installed and available in PATH (Claude Code, OpenCode, Codex, Antigravity)
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
| `MYCCUSAGE_CLAUDE_CONFIG_DIRS` | `claudeConfigDirs` | Unset; ccusage locates Claude Code data itself |

`MYCCUSAGE_AGENT_TYPES` is a comma-separated list. Supported values are `claude-code`, `amp`, `opencode`, `codex`, `dimagent`, `cursor`, and `antigravity`. Whitespace is trimmed and duplicates are removed. Unknown agents and empty list entries are rejected with a configuration error before collection begins.

Blank environment values count as unset, so an empty export never shadows a valid file entry. Device fields resolve independently: setting only `MYCCUSAGE_DEVICE_ID` still defaults the device name to the hostname. Agent selection uses the JSON `agentTypes` array or the environment list. Schedule and retry settings use JSON values or their defaults (every four hours, three attempts, 1000 ms retry delay).

### Claude Code Data Directories

By default ccusage reads Claude Code logs from `~/.config/claude` and `~/.claude`. When Claude Code runs with other config directories (for example, separate accounts), list every directory to collect:

```json
{
  "claudeConfigDirs": ["~/.claude", "/path/to/another/claude/config"]
}
```

or `MYCCUSAGE_CLAUDE_CONFIG_DIRS='~/.claude,/path/to/another/claude/config'`. Each entry is an absolute path or starts with `~/`, and may be a Claude config directory or its `projects/` directory. The list replaces the default lookup, so include `~/.claude` when it should still be collected. ccusage skips directories without a `projects/` folder and merges the rest; usage entries present in several directories are counted once.

The collector passes the list to ccusage as `CLAUDE_CONFIG_DIR` for the `claude-code` collection only. Claude Code itself reads `CLAUDE_CONFIG_DIR` to decide where it stores its configuration, so avoid exporting a comma-separated value globally in shell profiles. When `claudeConfigDirs` is set it takes precedence over any `CLAUDE_CONFIG_DIR` in the environment or shell profiles; when unset, ccusage uses an inherited `CLAUDE_CONFIG_DIR` or its default lookup.

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

Use a distinct device ID for each independent usage dataset. Reuse an ID across VM rebuilds only when the VM continues the same dataset: the dashboard upserts by device ID, date, and agent type, so independent VMs sharing an ID overwrite each other's daily totals rather than adding them. Changing the display name does not change device identity.

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

The collector:
- Uses explicit ccusage agent commands such as `ccusage claude daily --json`, `ccusage opencode daily --json`, `ccusage codex daily --json`, and `ccusage antigravity daily --json` (Antigravity reads its local SQLite conversation databases; set `ANTIGRAVITY_DATA_DIR` when they live outside the default `~/.gemini/*` roots)
- Collects AMP through the `amp` CLI (see below)
- Parses DimAgent's local SQLite store (`~/.dimcode/v2/dimcode.sqlite`) directly; no ccusage support needed
- Pulls Cursor usage from the cloud CSV export via the local session token in Cursor's state DB; no ccusage support needed. The export is account-wide, so enable Cursor on exactly one device per account to avoid double-counting
- Collects historical data (not just recent usage)
- Syncs complete usage records to your dashboard
- Supports upsert operations (updates existing records)
- Generates unique device fingerprints for multi-device tracking
- Allows custom device names for better dashboard readability

### AMP

AMP stores threads server-side, so the collector reads them through the `amp` CLI:

- Lists this machine's threads with `amp threads list --json --installation-id <id>` (the id comes from `~/.local/share/amp/device-id.json`), so each device reports only its own threads
- Exports new or changed threads with `amp threads export`, keeping only per-message usage in `~/.ccusage-collector/amp-cache/`. Exports hold the main agent's usage only
- Fetches `amp threads usage <id> --details` for each active day to add subagent and side-call usage (Task, Read Thread, View Media, Finder, Librarian, compaction, Thread Title) per model
- Rebuilds daily totals from the cache on every run

Notes:

- AMP allows 60 usage reports per hour. The collector uses at most 40 per hour, newest days first, and pauses for an hour when AMP reports the limit. Until a day's report is fetched, that day counts the main agent only. A large backfill therefore spreads over several syncs at least an hour apart, and each sync uploads the completed days again
- Usage AMP ran through Claude Code (`external-agent:claude-code`) is skipped, because ccusage already counts it under Claude Code
- Per-model input and output are exact. The report splits cache reads per thread-day only, so for subagent usage the cache-read share is estimated; main-agent usage keeps its exact split
- Cost is an API-equivalent estimate using LiteLLM's base input, output, cache-write and cache-read rates, including linked-provider usage. It is not AMP's actual charge. Prices are cached in `~/.ccusage-collector/pricing.json` for 24 hours; failed refreshes use the newest available cache or bundled snapshot
- Prices match exact model names and known provider/name-format variants, falling back to export/report aliases established by successful reconciliation. Unknown models, unsupported modalities (such as image generation), or missing rates for used token categories keep their tokens but contribute 0 cost, with a warning. Daily `rawData.costEstimate` records the price date, aliases used for pricing, and unpriced models
- Estimates use base rates, without inferring long-context/fast surcharges or cache-write duration from daily totals. Subagent cache splits remain estimates as described above. Updated prices revalue cached history on subsequent syncs
- The usage report is formatted text. If its format changes, affected days fall back to the main agent only and the collector logs a warning

Maintainers can refresh the bundled price snapshot with `pnpm --filter ccusage-collector update-pricing` from the repository root.

### Data Format
The collector syncs:
- Daily usage metrics (tokens, costs, models)
- Token breakdowns (input, output, cache creation/read)
- Model usage statistics
- Device information with optional custom display names for multi-device analytics

## Error Handling

- **Network failures**: Automatic retry with exponential backoff
- **Authentication errors**: Immediate failure (no retry on 401/403)
- **Individual record failures**: Continues processing other records
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
