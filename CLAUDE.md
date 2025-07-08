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