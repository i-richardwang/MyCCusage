# ccusage-collector

A command-line tool for collecting Claude Code usage statistics and syncing them to your self-hosted My Claude Code Usage Dashboard.

## Overview

This package automatically collects your local Claude Code usage data and syncs it to your dashboard, giving you insights into your AI-assisted development workflow.

## Installation

```bash
npm install -g ccusage-collector
npm install -g pm2
```

## Prerequisites

- Node.js ≥20
- PM2 process manager (for reliable background execution)
- Claude Code CLI installed and configured
- Access to a deployed My Claude Code Usage Dashboard

## Quick Start

### 1. Basic sync (run once)

```bash
ccusage-collector --api-key=your-api-key --endpoint=https://example.com/api/usage-sync
```

### 2. Scheduled sync (recommended - runs in background)

```bash
pm2 start ccusage-collector -- --api-key=your-api-key --endpoint=https://example.com/api/usage-sync --schedule="0 */4 * * *"
```

### 3. Test data collection (dry run)

```bash
ccusage-collector --api-key=test --endpoint=https://example.com/api/usage-sync --dry-run
```

## CLI Options

| Option | Description | Required | Default |
|--------|-------------|----------|---------|
| `-k, --api-key <key>` | API key for authentication | Yes | - |
| `-e, --endpoint <url>` | API endpoint URL | Yes | - |
| `-s, --schedule <cron>` | Cron schedule for periodic sync | No | - |
| `-r, --max-retries <number>` | Maximum retry attempts | No | 3 |
| `-d, --retry-delay <ms>` | Delay between retries (ms) | No | 1000 |
| `--dry-run` | Collect data but don't sync | No | false |
| `-h, --help` | Show help | No | - |
| `-V, --version` | Show version | No | - |

## Usage Examples

### One-time sync
```bash
ccusage-collector --api-key=sk-1234567890abcdef --endpoint=https://myccusage.example.com/api/usage-sync
```

### Scheduled sync (every 6 hours) - Background execution
```bash
pm2 start ccusage-collector -- \
  --api-key=sk-1234567890abcdef \
  --endpoint=https://myccusage.example.com/api/usage-sync \
  --schedule="0 */6 * * *"
```

### Test without syncing
```bash
ccusage-collector \
  --api-key=test \
  --endpoint=https://myccusage.example.com/api/usage-sync \
  --dry-run
```

## Cron Schedule Examples

| Schedule | Description |
|----------|-------------|
| `"0 */4 * * *"` | Every 4 hours |
| `"*/10 * * * *"` | Every 10 minutes |
| `"0 0 * * *"` | Daily at midnight |
| `"0 */1 * * *"` | Every hour |
| `"0 9,17 * * 1-5"` | 9 AM and 5 PM on weekdays |

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

### 3. Install and Run Collector
```bash
npm install -g ccusage-collector
npm install -g pm2

# Start background sync
pm2 start ccusage-collector -- --api-key=your-secret-api-key-here --endpoint=https://your-domain.com/api/usage-sync --schedule="0 */4 * * *"
```

## Data Collection

The collector:
- Uses `npx ccusage daily --json` to gather usage statistics
- Collects historical data (not just recent usage)
- Syncs complete usage records to your dashboard
- Supports upsert operations (updates existing records)

### Data Format
The collector syncs:
- Daily usage metrics (tokens, costs, models)
- Token breakdowns (input, output, cache creation/read)
- Model usage statistics
- Raw usage data for detailed analysis

## Error Handling

- **Network failures**: Automatic retry with exponential backoff
- **Authentication errors**: Immediate failure (no retry on 401/403)
- **Individual record failures**: Continues processing other records
- **Detailed logging**: Clear error messages and debugging info

## Process Management with PM2

For reliable background execution, use PM2 to manage the collector process:

### Start Background Sync
```bash
pm2 start ccusage-collector -- --api-key=your-key --endpoint=https://your-domain.com/api/usage-sync --schedule="0 */4 * * *"
```

### Check Status
```bash
pm2 list                    # Show all processes
pm2 show ccusage-collector  # Show detailed info
pm2 logs ccusage-collector  # View logs
pm2 monit                   # Real-time monitoring
```

### Control Process
```bash
pm2 stop ccusage-collector     # Stop process
pm2 restart ccusage-collector  # Restart process
pm2 delete ccusage-collector   # Remove process
```

### Auto-start on Boot
```bash
pm2 startup                    # Generate startup script
pm2 save                       # Save current process list
```

### Benefits of PM2
- **Automatic restart** if process crashes
- **Background execution** - no need to keep terminal open
- **Process monitoring** and logging
- **Prevents duplicate instances** - safe to run multiple times
- **Cross-platform** - works on Windows, Linux, and macOS

## Troubleshooting

### Common Issues

**"ccusage command not found"**
- Ensure Claude Code CLI is installed and in PATH
- Run `npx ccusage --help` to verify installation

**"Authentication failed"**
- Verify API key matches your dashboard configuration
- Check that API key is correctly set in dashboard environment

**"Connection refused"**
- Verify endpoint URL is correct and accessible
- Check that your dashboard is running and deployed

**"Invalid cron expression"**
- Use online cron validators to test expressions
- Ensure cron format is correct (5 fields: minute hour day month weekday)

### Debug Mode
```bash
# Enable verbose logging
DEBUG=ccusage-collector ccusage-collector --api-key=... --endpoint=...
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
pnpm cli --dry-run --api-key=test --endpoint=http://localhost:3000

# Run type checking
pnpm typecheck

# Run linting
pnpm lint
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Related Projects

- [My Claude Code Usage Dashboard](https://github.com/i-richardwang/MyCCusage) - The main dashboard application
- [Claude Code](https://claude.ai/code) - The AI-powered coding assistant

## Support

- 🐛 [Report bugs](https://github.com/i-richardwang/MyCCusage/issues)
- 💡 [Request features](https://github.com/i-richardwang/MyCCusage/issues)