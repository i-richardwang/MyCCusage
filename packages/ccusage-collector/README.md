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

### 1. Interactive Configuration

```bash
ccusage-collector config
```

This will prompt you for:
- **API Key** (hidden input)
- **Dashboard URL** (domain only, e.g., https://your-app.com)
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
| `ccusage-collector start` | Start scheduled sync (requires configuration) |
| `ccusage-collector sync` | Run single sync operation |
| `ccusage-collector sync --dry-run` | Test data collection without syncing |
| `ccusage-collector status` | Check configuration status |
| `ccusage-collector test` | Test configuration and connection |
| `ccusage-collector --help` | Show help |

## Configuration

Configuration is stored in `~/.ccusage-collector/config.json` with user-only file permissions.

### Interactive Configuration

```bash
ccusage-collector config
```

**Sample Configuration Session:**
```
🔧 ccusage-collector Configuration Wizard
=========================================

? Enter your API Key: ********** (hidden input)
? Enter your dashboard URL (domain only): https://myccusage.example.com
? Select sync frequency: Every 4 hours

🧪 Testing configuration...
✅ Configuration test passed!
✅ Configuration saved successfully!

💡 Start with PM2:
   pm2 start ccusage-collector -- start
```

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
# Install globally
npm install -g ccusage-collector
npm install -g pm2

# Configure
ccusage-collector config

# Start background sync
pm2 start ccusage-collector -- start
```

## Data Collection

The collector:
- Uses `npx ccusage daily --json` to gather usage statistics
- Collects historical data (not just recent usage)
- Syncs complete usage records to your dashboard
- Supports upsert operations (updates existing records)
- Generates unique device fingerprints for multi-device tracking

### Data Format
The collector syncs:
- Daily usage metrics (tokens, costs, models)
- Token breakdowns (input, output, cache creation/read)
- Model usage statistics
- Device information for multi-device analytics

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
- Ensure Claude Code CLI is installed and in PATH
- Run `npx ccusage --help` to verify installation

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

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Related Projects

- [My Claude Code Usage Dashboard](https://github.com/i-richardwang/MyCCusage) - The main dashboard application
- [Claude Code](https://claude.ai/code) - The AI-powered coding assistant

## Support

- 🐛 [Report bugs](https://github.com/i-richardwang/MyCCusage/issues)
- 💡 [Request features](https://github.com/i-richardwang/MyCCusage/issues)
- 📚 [Documentation](https://github.com/i-richardwang/MyCCusage/blob/main/README.md)