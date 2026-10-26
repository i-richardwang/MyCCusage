# ccusage-collector

A command-line tool for collecting coding agent usage statistics and syncing them to your self-hosted My Claude Code Usage Dashboard.

## Overview

Collect usage from selected coding agents, attach device identity, and sync daily records to your dashboard. Configure the collector through environment variables or an optional JSON file.

## Installation

Install globally with Bun (recommended):

```bash
bun add -g ccusage-collector
bun add -g pm2
```

Or with npm:

```bash
npm install -g ccusage-collector
npm install -g pm2
```

Or run one-off commands without installing:

```bash
bunx ccusage-collector config
bunx ccusage-collector sync
```

## Prerequisites

- Bun ≥1.0 or Node.js ≥20
- PM2 process manager (optional, for background execution with `start`)
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
pm2 start ccusage-collector -- start
```

### 3. Check Status

```bash
ccusage-collector status
pm2 status
```

## Available Commands

| Command | Description |
|---------|-------------|
| `ccusage-collector config` | Interactive configuration wizard |
| `ccusage-collector start` | Start scheduled sync |
| `ccusage-collector sync` | Run single sync operation |
| `ccusage-collector sync --dry-run` | Test data collection without syncing |
| `ccusage-collector status` | Check configuration status |
| `ccusage-collector test` | Test configuration and connection |
| `ccusage-collector --help` | Show help |

## Configuration

Configuration resolves in this order: **nonblank environment variables → JSON configuration → defaults**. The optional JSON file is `~/.ccusage-collector/config.json`, written with user-only file permissions by the `config` wizard.

`sync`, `start`, `test`, and `status` never create or modify this configuration file. Agent-specific data caches (such as AMP exports and pricing) are separate and may still be written.

The JSON object accepts `apiKey`, `endpoint`, `agentTypes`, `deviceId`, `deviceName`, `displayName`, `schedule`, `maxRetries`, and `retryDelay`. Unknown fields are rejected. Schedule labels are derived for display and are not stored.

### Environment Variables

Credentials, agent selection, and device identity can all be supplied through the environment:

| Variable | JSON field | Default when not configured |
|---|---|---|
| `MYCCUSAGE_API_KEY` | `apiKey` | Required |
| `MYCCUSAGE_ENDPOINT` | `endpoint` | Required; full HTTP(S) URL including `/api/usage-sync` |
| `MYCCUSAGE_AGENT_TYPES` | `agentTypes` | `claude-code` |
| `MYCCUSAGE_DEVICE_ID` | `deviceId` | Fingerprint derived from hostname and MAC addresses |
| `MYCCUSAGE_DEVICE_NAME` | `deviceName` | Hostname |
| `MYCCUSAGE_DISPLAY_NAME` | `displayName` | Unset; the dashboard uses the device name |

`MYCCUSAGE_AGENT_TYPES` is a comma-separated list. Supported values are `claude-code`, `amp`, `opencode`, `codex`, `dimagent`, `cursor`, and `antigravity`. Whitespace is trimmed and duplicates are removed. Unknown agents and empty list entries are rejected with a configuration error before collection begins.

Blank environment values count as unset, so an empty export never shadows a valid file entry. Device fields resolve independently: setting only `MYCCUSAGE_DEVICE_ID` still defaults the device name to the hostname. Agent selection uses the JSON `agentTypes` array or the environment list. Schedule and retry settings use JSON values or their defaults (every four hours, three attempts, 1000 ms retry delay).

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

No interactive setup or configuration file is needed. A platform scheduler can invoke `sync` periodically; use `start` if you want the collector's built-in scheduler. The collector must have access to the selected agents' usage data and required CLIs in that environment. `.env` files are not loaded automatically; `.env.example` is a reference for your platform's environment injection.

Use a distinct device ID for each independent usage dataset. Reuse an ID across VM rebuilds only when the VM continues the same dataset: the dashboard upserts by device ID, date, and agent type, so independent VMs sharing an ID overwrite each other's daily totals rather than adding them. Changing the display name does not change device identity.

The `config` wizard skips credential, agent-selection, and display-name questions supplied by the environment. When explicitly saving JSON, environment overrides are not persisted; existing file values for those fields are preserved. `status` shows resolved settings without printing the API key.

Production example with PM2 (`ecosystem.config.js`):

```js
module.exports = {
  apps: [{
    name: "ccusage-collector",
    script: "ccusage-collector",
    args: "start",
    env: {
      MYCCUSAGE_API_KEY: "your-secret-api-key",
      MYCCUSAGE_ENDPOINT: "https://your-app.com/api/usage-sync",
      MYCCUSAGE_AGENT_TYPES: "claude-code,codex",
      MYCCUSAGE_DEVICE_ID: "cloud-dev-01",
      MYCCUSAGE_DISPLAY_NAME: "Cloud development",
    },
  }],
};
```

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
Start background sync: pm2 start ccusage-collector -- start
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

## Usage Examples

### Complete Setup Flow

```bash
# 1. Configure credentials
ccusage-collector config

# 2. Test the configuration
ccusage-collector test

# 3. Start background sync
pm2 start ccusage-collector -- start

# 4. Check status
ccusage-collector status
pm2 status
```

### Maintenance Commands

```bash
# View sync logs
pm2 logs ccusage-collector

# Restart sync process
pm2 restart ccusage-collector

# Stop sync process
pm2 stop ccusage-collector

# Run one-time sync
ccusage-collector sync

# Test without syncing
ccusage-collector sync --dry-run
```

## Setup Guide

### 1. Deploy the Dashboard
First, deploy your own instance of My Claude Code Usage Dashboard:
- Clone the repository
- Set up PostgreSQL database
- Configure environment variables
- Deploy to your preferred platform

### 2. Get API Key
Set the `API_KEY` environment variable in your dashboard deployment:
```env
API_KEY=your-secret-api-key-here
```

### 3. Install and Configure Collector
```bash
# Install globally (or use npm install -g)
bun add -g ccusage-collector
bun add -g pm2

# Configure
ccusage-collector config

# Start background sync
pm2 start ccusage-collector -- start
```

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

## Process Management with PM2

### Why PM2?
- **Automatic restart** if process crashes
- **Background execution** - no need to keep terminal open
- **Process monitoring** and logging
- **Prevents duplicate instances** - safe to run multiple times
- **Cross-platform** - works on Windows, Linux, and macOS

### PM2 Commands

```bash
# Start background sync
pm2 start ccusage-collector -- start

# Check status
pm2 list                    # Show all processes
pm2 show ccusage-collector  # Show detailed info
pm2 logs ccusage-collector  # View logs
pm2 monit                   # Real-time monitoring

# Control process
pm2 stop ccusage-collector     # Stop process
pm2 restart ccusage-collector  # Restart process
pm2 delete ccusage-collector   # Remove process

# Auto-start on boot
pm2 startup                    # Generate startup script
pm2 save                       # Save current process list
```

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
pm2 logs ccusage-collector
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
