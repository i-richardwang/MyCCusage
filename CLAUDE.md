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
- `usage_records` - Claude API usage data with daily aggregation per device
- `devices` - Device information and metadata
- Both tables use unique constraints for upsert operations

## Chart Development Standards

### Architecture Overview

**Chart System Structure:**
```
/types/chart-types.ts          # Unified type definitions
/constants/chart-config.ts     # Configuration constants  
/hooks/use-chart-data.ts       # Data processing hooks
/components/[chart-name].tsx   # UI rendering components
/api/[endpoint]/route.ts       # Backend queries
```

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
export function useNewChartData(
  rawData: RawDataType[],
  timeRange: TimeRange
): NewChartData {
  return useMemo(() => {
    // Data transformation logic
    const processedData = rawData.map(record => ({
      date: record.date,
      // Transform fields
    }))
    
    // Apply time filtering
    const filteredData = filterByTimeRange(processedData, timeRange)
    
    return {
      chartData: filteredData,
      chartConfig: NEW_CHART_CONFIG
    }
  }, [rawData, timeRange])
}
```

**4. API Query Optimization**
```tsx
// In /api/[endpoint]/route.ts
const newChartData = await db
  .select({
    // Select only needed fields
    date: table.date,
    value: sql<number>`SUM(${table.value})::numeric`,
    // Use aggregation when possible
  })
  .from(table)
  .groupBy(table.date)
  .orderBy(desc(table.date))
  .limit(appropriate_limit)
```

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
- Limit results appropriately (30 for daily, 300 for device-specific)
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