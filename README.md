# My Claude Code Usage Dashboard

A self-hosted web dashboard for tracking Claude Code usage statistics with automatic data collection and synchronization.

## Features

- 📊 **Usage Analytics**: Track usage per hour, day and model, including tokens, reasoning, requests and costs
- 🔄 **Auto Sync**: Automatic data collection from local Claude Code usage
- 📱 **Responsive Dashboard**: Clean, modern UI built with shadcn/ui components
- 🏠 **Self-Hosted**: Deploy on your own infrastructure
- 🔧 **Easy Setup**: Simple configuration and deployment

## Architecture

This is a monorepo built with:
- **Next.js 16** + **React 19** + **TypeScript**
- **shadcn/ui** component system
- **PostgreSQL** + **Drizzle ORM**
- **Turbo** for build orchestration
- **pnpm** for package management

### Project Structure

```
├── apps/
│   └── web/              # Next.js dashboard application
├── packages/
│   ├── ui/               # Shared UI components (shadcn/ui)
│   ├── ccusage-collector/ # NPM package for data collection
│   ├── eslint-config/    # Shared ESLint configurations
│   └── typescript-config/ # Shared TypeScript configurations
```

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/i-richardwang/MyCCusage.git
cd MyCCusage
pnpm install
```

### 2. Database Setup

```bash
# Set up your PostgreSQL database
cp apps/web/.env.example apps/web/.env.local

# Configure your database URL and API key
DATABASE_URL=postgresql://username:password@localhost:5432/myccusage
API_KEY=your-secret-api-key-here

# Run database migrations
cd apps/web
pnpm db:push
```

### 3. Start Development Server

```bash
pnpm dev
```

Visit [http://localhost:3000](http://localhost:3000) to see your dashboard.

### 4. Install Data Collector

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

### 5. Configure and Start Data Collection

```bash
# Interactive configuration
ccusage-collector config

# Install native background sync (macOS / Linux)
ccusage-collector service install
```

Native scheduling uses a macOS LaunchAgent or Linux systemd user timer, with no resident collector process. Inspect it with `ccusage-collector service status` and `ccusage-collector service logs`; remove it with `ccusage-collector service uninstall`.

For cloud or sandbox environments, inject `MYCCUSAGE_API_KEY`, `MYCCUSAGE_ENDPOINT`, `MYCCUSAGE_AGENT_TYPES`, and optional device variables, then run `ccusage-collector sync` directly. No JSON configuration is required; see the [environment-only setup](packages/ccusage-collector/README.md#cloud--sandbox-vm-no-json-required).

## Data Collection

The `ccusage-collector` package automatically:
- Reads Claude Code and Codex transcripts and reports their usage per hour and model, pricing every request on its own
- Reports DimAgent (local SQLite store) and Cursor (cloud export) usage per hour and model
- Collects OpenCode and Antigravity usage with explicit ccusage agent commands, such as `ccusage opencode daily --json`
- Collects AMP usage, including subagents, through the `amp` CLI (see the [collector README](packages/ccusage-collector/README.md#amp))
- Syncs historical data to your dashboard
- Supports scheduled automatic synchronization
- Handles retries and error recovery

## Deployment

### Web Dashboard

Deploy the Next.js app to your preferred platform:
- Vercel
- Netlify
- Railway
- Self-hosted with Docker

### Database

Supported PostgreSQL providers (PostgreSQL 15 or later):
- [Neon](https://neon.tech/)
- [Supabase](https://supabase.com/)
- [PlanetScale](https://planetscale.com/)
- Self-hosted PostgreSQL

### Updating

Collectors and the dashboard must speak the same sync protocol, and each refuses the other otherwise. Update in this order:

1. Run `pnpm db:migrate` from `apps/web/`, then deploy the dashboard.
2. Update every collector.

## Commands

```bash
# Development
pnpm dev                    # Start development server
pnpm build                  # Build all packages
pnpm lint                   # Lint all code
pnpm format                 # Format code with Prettier

# Database (run from apps/web/)
pnpm db:generate           # Generate migration files
pnpm db:push               # Push schema changes
pnpm db:migrate            # Run migrations
pnpm db:studio             # Open database studio

# Web App (run from apps/web/)
pnpm dev                   # Start Next.js dev server
pnpm build                 # Build production app
pnpm start                 # Start production server
pnpm lint                  # Run ESLint
pnpm typecheck             # Run TypeScript checks
```

## Adding UI Components

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

This places components in `packages/ui/src/components/` for shared use.

## Environment Variables

### Web Application (.env.local)

```env
DATABASE_URL=postgresql://username:password@localhost:5432/myccusage
API_KEY=your-secret-api-key-here
# Optional: account time zone for daily buckets (default Asia/Shanghai)
USAGE_TIMEZONE=Asia/Shanghai
```

### Collector Configuration

```bash
# Interactive configuration
ccusage-collector config

# Check configuration status
ccusage-collector status

# Test configuration and connection
ccusage-collector test

# Start scheduled sync
ccusage-collector service install
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- Create an issue for bug reports or feature requests
- Check the [documentation](docs/) for detailed guides
- Join our community discussions
