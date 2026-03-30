# XClaw

> AI Agent Platform with Web UI, Desktop App, and Backend API

English | [中文](README.zh.md)

## Overview

XClaw is an AI agent platform that provides a modern web interface for interacting with AI agents. It consists of three main components:

- **Web App** (Next.js 16) - Modern React-based UI
- **Desktop App** (Electron 33) - Native desktop wrapper
- **Studio API** (Python Flask) - Backend services

## Features

- Real-time chat with AI agents
- Support for multiple agents and skills
- Task management and monitoring
- Gateway integration for AI processing
- Desktop application for offline access
- Rich message rendering (Markdown, code blocks, tables)

## Prerequisites

- Node.js 18+
- pnpm 10+
- Python 3.11+ (for Studio API)
- OpenClaw Gateway (running on port 20064 by default)

## Quick Start

```bash
# Install dependencies
pnpm install

# Prepare OpenClaw runtime (required once)
cd apps/desktop
npm run prepare:openclaw-runtime
cd ../..

# One-key install + start (recommended)
pnpm run install:run

# Or run development server directly (web + desktop)
pnpm dev

# Or run all services (web + desktop + studio-api)
pnpm dev:all

# Build for production
pnpm build

# Build Electron app
pnpm electron:build
```

## Project Structure

```
xclaw-monorepo/
├── apps/
│   ├── web/           # Next.js 16 web application
│   ├── desktop/      # Electron desktop app
│   └── studio-api/   # Python Flask backend
├── docs/             # Documentation
├── packages/         # Shared packages
└── scripts/         # Build scripts
```

## Environment Variables

Default configuration (usually no changes needed):

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_STATE_DIR` | `$HOME/.xclaw` | State directory |
| `OPENCLAW_CONFIG_PATH` | `$HOME/.xclaw/openclaw.json` | Config file path |
| `OPENCLAW_GATEWAY_PORT` | `20064` | Gateway port |
| `OPENCLAW_GATEWAY_HOST` | `127.0.0.1` | Gateway host |

## Development

### Running Individual Services

```bash
# Web only
pnpm dev:web

# Desktop only
pnpm dev:desktop

# Studio API only
pnpm dev:studio-api
```

### Code Quality

```bash
# Lint
pnpm lint

# Type check
pnpm typecheck

# Run tests
pnpm test
```

## API Endpoints

- `/api/chat/*` - Chat messaging
- `/api/gateways/*` - Gateway management
- `/api/skills/*` - Skills registry
- `/api/sessions` - Session management
- `/api/agents/*` - Agent management

## Tech Stack

- **Frontend**: React 19, Next.js 16, Tailwind CSS 4
- **State**: Zustand
- **UI**: Radix UI, Framer Motion
- **Desktop**: Electron 33
- **Backend**: Python Flask
- **Database**: SQLite (better-sqlite3)

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

- Open an issue for bugs or feature requests
- Check [docs/](docs/) for detailed documentation
