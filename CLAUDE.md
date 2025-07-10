# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a shadcn/ui monorepo template built with Next.js 15, React 19, and TypeScript. It uses Turbo for build orchestration and pnpm for package management.

## Architecture

**Monorepo Structure:**
- `apps/web/` - Next.js application with shadcn/ui components
- `packages/ui/` - Shared UI component library with shadcn/ui components
- `packages/eslint-config/` - Shared ESLint configurations
- `packages/typescript-config/` - Shared TypeScript configurations

**Key Dependencies:**
- Next.js 15 with Turbopack for development
- React 19 with TypeScript
- Tailwind CSS 4.0 for styling
- Radix UI primitives for component foundations
- shadcn/ui component system

## Common Commands

**Development:**
```bash
pnpm dev                    # Start development server for all apps
pnpm build                  # Build all apps and packages
pnpm lint                   # Lint all code
pnpm format                 # Format code with Prettier
```

**Web App Specific (run from apps/web/):**
```bash
pnpm dev                    # Start Next.js dev server with Turbopack
pnpm build                  # Build Next.js app
pnpm start                  # Start production server
pnpm lint                   # Run ESLint
pnpm lint:fix              # Run ESLint with auto-fix
pnpm typecheck             # Run TypeScript compiler check
```

**Adding shadcn/ui Components:**
```bash
pnpm dlx shadcn@latest add button -c apps/web
```
This places components in `packages/ui/src/components/` and makes them available to all apps.

## Component System

**UI Package Structure:**
- Components are in `packages/ui/src/components/`
- Utilities are in `packages/ui/src/lib/`
- Global styles are in `packages/ui/src/styles/globals.css`

**Component Import Pattern:**
```tsx
import { Button } from "@workspace/ui/components/button"
```

**Component Architecture:**
- Built on Radix UI primitives
- Uses `class-variance-authority` for variant management
- Styled with Tailwind CSS
- Supports theme switching with `next-themes`

## Build System

**Turbo Configuration:**
- Build tasks run in dependency order
- Lint tasks run in parallel
- Dev mode is persistent and uncached
- TypeScript checking with `check-types` task

**Package Management:**
- Uses pnpm workspaces
- Workspace dependencies use `workspace:*` protocol
- Node.js ≥20 required

## TypeScript & Linting

**TypeScript:**
- Strict mode enabled
- Shared configs in `packages/typescript-config/`
- Different configs for Next.js apps vs libraries

**ESLint:**
- Shared configs in `packages/eslint-config/`
- Configurations for base, Next.js, and React components
- Uses TypeScript ESLint parser and rules

## Database & ORM

**Database Setup:**
- PostgreSQL database hosted on Neon
- Drizzle ORM for type-safe database operations
- Environment-based configuration via `DATABASE_URL`

**Schema Location:**
- Database schema: `apps/web/src/db/schema.ts`
- Database connection: `apps/web/src/db/index.ts`
- Drizzle config: `apps/web/drizzle.config.ts`

**Database Commands (run from apps/web/):**
```bash
pnpm db:generate             # Generate migration files from schema changes
pnpm db:migrate              # Apply migrations to database
pnpm db:push                 # Push schema changes directly
pnpm db:studio               # Open Drizzle Studio to view/edit data
```

**Key Tables:**
- `usage_records` - Claude API usage data with daily aggregation
  - Unique constraint on `date` field for upsert operations
  - Includes tokens, costs, and raw ccusage data

## UI Design Standards

### shadcn/ui Component Guidelines

**Chart Components:**
- Always import `ChartConfig` and use `satisfies ChartConfig` for type safety
- Chart configuration should follow this pattern:
```tsx
const chartConfig = {
  cost: {
    label: "Cost",
    color: "var(--chart-1)"
  },
  // ... other chart series
} satisfies ChartConfig
```

**Card Component Layout Standards:**
- **Chart containers**: Use `<Card className="pt-0">` to provide proper spacing for charts
- **Non-chart containers**: Use `<Card>` (no pt-0) to maintain vertical centering
- **Statistics cards**: Use `<Card>` (no pt-0) to ensure content is vertically centered

**CardContent Spacing Rules:**
- **Chart containers**: `className="px-2 pt-4 sm:px-6 sm:pt-6"` (charts need top space, tight bottom)
- **Non-chart containers**: `className="px-2 py-4 sm:px-6 sm:py-4"` (symmetric vertical spacing)
- **Statistics cards**: `className="p-6"` (symmetric padding on all sides)

**Chart XAxis Standards:**
- Use inline `tickFormatter` functions for date formatting
- Set `dataKey="date"` directly on chart data
- Example:
```tsx
<XAxis
  dataKey="date"
  tickLine={false}
  axisLine={false}
  tickMargin={8}
  minTickGap={32}
  tickFormatter={(value) => {
    const date = new Date(value)
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })
  }}
/>
```

**Container Hierarchy:**
- All major sections follow the pattern: `Card` > `CardHeader` > `CardContent`
- CardHeader uses: `className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row"`
- Maintain consistent grid layouts and responsive breakpoints