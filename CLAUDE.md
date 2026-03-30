# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

XClaw is an AI agent platform with a Next.js web UI, Electron desktop wrapper, and Python Flask backend API. It connects to an external OpenClaw gateway for AI capabilities and uses SQLite for local persistence.

## Common Commands

```bash
# Development
pnpm dev              # Run web + desktop (web on port 20263)
pnpm dev:all         # Run web + desktop + studio-api (Python backend on port 19101)
pnpm run install:run # One-key install + start (recommended for fresh machines)
pnpm dev:web         # Run only web app
pnpm dev:desktop     # Run only desktop app
pnpm dev:studio-api  # Run only Python backend

# OpenClaw runtime preparation (required once per machine)
cd apps/desktop
npm run prepare:openclaw-runtime
cd ../..

# Building
pnpm build            # Build Next.js web app
pnpm electron:build  # Build Electron desktop app
pnpm electron:pack   # Pack Electron app (unpacked dir)

# Quality
pnpm lint            # Lint web app
pnpm typecheck       # TypeScript type checking

# Testing
pnpm test            # Run all tests (Vitest)
pnpm --filter @xclaw/web test -- --run <file>  # Run single test file
```

## Environment Variables

Default configuration (no .env needed for local dev):
- `OPENCLAW_STATE_DIR`: `$HOME/.xclaw`
- `OPENCLAW_CONFIG_PATH`: `$HOME/.xclaw/openclaw.json`
- `OPENCLAW_GATEWAY_PORT`: `20064`
- `OPENCLAW_GATEWAY_HOST`: `127.0.0.1`

## Architecture

### Apps Structure
```
apps/
├── web/          # Next.js 16 app (React 19, port 20263)
├── desktop/      # Electron 33 wrapper
└── studio-api/   # Python Flask backend (port 19101)
```

### Web App Routes
- `/` - Main chat interface
- `/login` - Authentication
- `/setup` - Initial setup flow
- `/settings` - Settings pages (overview, agents, tasks, channels, skills, etc.)
- `/api/*` - Backend API routes

### Key API Endpoints
- `/api/chat/messages`, `/api/chat/conversations` - Chat functionality
- `/api/gateways/*` - Gateway connection/health
- `/api/skills/*` - Skills registry and management
- `/api/sessions` - Session management
- `/api/integrations` - External integrations

### Data Flow
1. Web app sends requests to Next.js API routes
2. API routes communicate with OpenClaw gateway (SSE for streaming, WebSocket for real-time)
3. SQLite database stores local state in `.data/` directory

### State Management
- Zustand (`useXClawStore`) for global state
- Real-time updates via SSE and WebSockets

### UI Stack
- React 19 with Next.js 16
- Tailwind CSS 4
- Radix UI components
- Framer Motion for animations
- Recharts, Reagraph, @xyflow/react for data visualization
