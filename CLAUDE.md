# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MyCCusage is a self-hosted dashboard for tracking coding-agent usage statistics (Claude Code, Codex, OpenCode, AMP). It is a monorepo built with Next.js 16, React 19, and TypeScript, using Turbo for build orchestration and pnpm for package management.

## Architecture

**Monorepo Structure:**
- `apps/web/` - Next.js dashboard application with shadcn/ui components
- `packages/ccusage-collector/` - Published npm CLI that collects local usage data and syncs it to the dashboard
- `packages/ui/` - Shared UI component library with shadcn/ui components
- `packages/eslint-config/` - Shared ESLint configurations
- `packages/typescript-config/` - Shared TypeScript configurations

**Key Dependencies:**
- Next.js 16 with Turbopack for development
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

## Component System

**Import Pattern:**
```tsx
import { Button } from "@workspace/ui/components/button"
```

**Architecture:**
- Built on Radix UI primitives with shadcn/ui
- Styled with Tailwind CSS
- TypeScript strict mode enabled

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
- `usage_buckets` - Usage per device, agent and model, in an hour of the
  account calendar (`hour_start` set) or a whole day. Each sync replaces whole
  days of one device's agent, so a day holds either hours or day buckets
- `devices` - Device information and metadata

## Usage collection and synchronization

- `packages/ccusage-collector/src/ccusage.ts` adapts OpenCode and Antigravity CLI output. Claude Code and Codex use `transcripts/`; AMP, Cursor and DimAgent have their own adapters.
- The collector owns source reads, pricing and account-calendar bucketing. `collector.ts` coordinates the adapters and transport; `sync.ts` owns command locking and run status.
- Sync protocol 3 defines timezone validation, hourly/model buckets, and `backfillBefore`. It has one version check, with no capability negotiation or legacy upload path.
- `apps/web/lib/usage-sync.ts` validates uploads and plans which complete days to write. `usage-store.ts` performs that plan in a database transaction; the HTTP route handles authentication and responses.
- Normal uploads replace complete device/agent days. Full-history uploads preserve any existing day before `backfillBefore`; only missing historical days are inserted. Provider transcript retention may make imported old history incomplete.
- `selectUsage` derives dashboard totals, models and hourly coverage from the selected records. Components render those results.
- PostgreSQL integration tests use `MYCCUSAGE_TEST_DATABASE_URL`, a disposable local database, and isolated schemas. CI runs them against PostgreSQL 15.

## Chart Development Standards

### Architecture Overview

**Chart System Structure:**
```
/api/usage-sync/route.ts       # Uploads, validated by /lib/usage-sync.ts
/api/usage-stats/route.ts      # Day and hour usage from usage_buckets
/lib/usage-view.ts             # Selected agent and day range, and every metric
/types/chart-types.ts          # Unified type definitions
/constants/chart-config.ts     # Configuration constants
/hooks/use-chart-data.ts       # Shapes the view into chart series
/components/[chart-name].tsx   # UI rendering components
```

**Data Flow:**
- `/api/usage-stats` returns `records` (one device, agent and model on one
  day, hours summed into their day), `hourly` (one agent in one hour, where
  sources report hours), devices, the account time zone and the billing start
  date.
- The page resolves the selected period to a concrete `DayRange` (all time
  starts on the first recorded day) and calls `selectUsage` once. The resulting
  `UsageView` holds the selected records, one zero-filled entry per day of the
  range, per-model totals, every hour of the range with its hourly records
  (ranges up to `HOURLY_RANGE_DAYS`), and the `summary` with every metric.
- Input tokens exclude cache reads and writes; output tokens include
  reasoning.
- Components and hooks read the view. They never filter by agent or date, and
  never compute a metric the summary already defines.

### Adding New Charts - Standard Process

**1. Define Types (types/chart-types.ts)**
```tsx
// Add new interfaces following existing patterns
interface NewChartRecord {
  date: string
  [key: string]: string | number  // Chart-specific fields
}

interface NewChartData {
  chartData: NewChartRecord[]
  chartConfig: Record<string, { label: string; color: string }>
}
```

**2. Add Configuration (constants/chart-config.ts)**
```tsx
export const NEW_CHART_CONFIG = {
  field1: {
    label: "Field 1",
    color: "var(--chart-1)"
  },
  field2: {
    label: "Field 2", 
    color: "var(--chart-2)"
  }
} as const
```

**3. Create Data Hook (hooks/use-chart-data.ts)**
```tsx
export function useNewChartData(view: UsageView): NewChartData {
  return useMemo(() => {
    // view.daily covers every day of the range; view.records is the selection
    const chartData = view.daily.map(day => ({
      date: day.date,
      // Transform fields
    }))

    return {
      chartData,
      chartConfig: NEW_CHART_CONFIG
    }
  }, [view])
}
```

**4. New Metrics**
- A metric shown for the selected period belongs in `UsageSummary`
  (`lib/usage-view.ts`), so every card and chart shares one definition
- A new dimension of usage is added to `usage_buckets`, the upload format and
  the `/api/usage-stats` select, not as a separate aggregated query

### Adding New API Queries - Standards

**1. Query Structure Pattern**
```tsx
// Always use typed select with explicit field mapping
const results = await db
  .select({
    fieldName: sql<ExpectedType>`SQL_EXPRESSION`,
    // Use proper type casting (::numeric, ::bigint, etc.)
  })
  .from(primaryTable)
  .leftJoin(relatedTable, eq(primaryTable.id, relatedTable.foreignId))
  .where(sql`appropriate_filters`)
  .groupBy(groupingFields)
  .orderBy(desc(orderField))
```

**2. Performance Considerations**
- Use `sql<Type>` for aggregations with proper PostgreSQL casting
- Add database indexes for frequently queried fields
- Use LEFT JOIN instead of multiple queries when possible

**3. Data Processing Standards**
```tsx
// Transform database results to chart format
const processedData = rawResults.map(record => ({
  // Convert numeric fields explicitly
  numericField: Number(record.numericField || 0),
  // Handle optional fields safely
  optionalField: record.optionalField || defaultValue,
  // Preserve date strings as-is for chart compatibility
  date: record.date
}))
```

### shadcn/ui Chart Implementation

**Card Layout Standards:**
- **Chart containers**: `<Card className="pt-0">`
- **CardContent**: `className="px-2 pt-4 sm:px-6 sm:pt-6"`
- **CardHeader**: `className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row"`

**Chart Configuration Pattern:**
```tsx
const chartConfig = PREDEFINED_CONFIG satisfies ChartConfig

<ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
  <AreaChart data={chartData}>
    <CartesianGrid vertical={false} />
    <XAxis
      dataKey="date"
      tickFormatter={(value) => {
        const date = new Date(value)
        return date.toLocaleDateString("en-US", {
          month: "short", day: "numeric"
        })
      }}
    />
    <ChartTooltip content={<ChartTooltipContent />} />
    <ChartLegend content={<ChartLegendContent />} />
  </AreaChart>
</ChartContainer>
```

### Key Principles

**Type Safety:**
- Always use shared types from `/types/chart-types.ts`
- Use `satisfies ChartConfig` for chart configurations
- Explicit type casting for database queries

**Performance:**
- Use `useMemo` for expensive data transformations
- Implement proper database aggregation
- Cache-friendly time range filtering

**Maintainability:**
- Centralize configuration in constants
- Separate data logic into custom hooks
- Keep components focused on UI rendering only

**Consistency:**
- Follow established naming conventions
- Use standardized color schemes from CHART_COLORS
- Maintain uniform spacing and layout patterns