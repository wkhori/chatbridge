# ChatBridge

AI chat platform with third-party app integration, built for K-12 education. Students interact with embedded apps (chess, whiteboard, classroom tools) through natural language while AI orchestrates tool calls, manages app lifecycles, and generates interactive widgets on the fly.

Built on a forked [Chatbox](https://github.com/chatboxai/chatbox) — Electron + React + TypeScript + Vite.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    ChatBridge Platform                     │
│                                                           │
│  ┌─────────┐   ┌──────────────┐   ┌──────────────────┐  │
│  │  Chat UI │   │  AI Engine   │   │  App Bridge      │  │
│  │ (React)  │◄─►│ (Vercel SDK) │◄─►│  Manager         │  │
│  └─────────┘   └──────────────┘   └────────┬─────────┘  │
│                                              │            │
│           ┌──────────── postMessage ─────────┤            │
│           │              Protocol            │            │
│           ▼                                  ▼            │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐    │
│  │ ♟️ Chess App  │  │ 🎨 Whiteboard │  │ 📚 Classroom │    │
│  │  (iframe)    │  │   (iframe)   │  │  (iframe)   │    │
│  │  Stockfish   │  │   cre8 demo  │  │  OAuth2     │    │
│  └──────────────┘  └──────────────┘  └─────────────┘    │
└──────────────────────────────────────────────────────────┘
```

**Communication:** Typed postMessage protocol (14 message types, Zod-validated, rate-limited, nonce-tracked) between platform and sandboxed iframe apps.

## Features

- **Plugin Protocol** — Manifest-based app registration, sandboxed iframes, typed postMessage bridge with Zod schema validation, rate limiting (30 msg/sec), and nonce tracking
- **Three Integrated Apps** — Chess (Stockfish WASM engine), cre8 Whiteboard (view-only embed), Google Classroom (OAuth2 popup flow)
- **Generative Micro-Apps** — AI creates interactive HTML widgets mid-conversation (quizzes, visualizers, calculators) rendered in sandboxed iframes
- **Dynamic Conversational UI** — AI generates contextual action buttons per turn (like Telegram inline keyboards)
- **LLM Security Review Agent** — 3-layer manifest auditor: schema validation, deterministic checks, optional LLM analysis
- **Multi-App Routing** — 3-tier context injection (full/summary/none) with keyword-based promotion and staleness demotion
- **Platform Auth** — Role-based login (student/teacher) gating the chat experience

## Setup

### Prerequisites
- Node.js >= 20
- pnpm >= 10

### Install & Run

```bash
# Install dependencies
pnpm install

# Run the web app (development)
pnpm dev:web

# Run the chess app dev server (separate terminal)
cd apps/chess && pnpm dev

# Run the classroom app dev server (separate terminal)
cd apps/classroom && pnpm dev

# Build for production
pnpm build:web
```

### Environment Variables

Configure an AI provider in the app settings (Settings > Model Provider). Supports OpenAI, Anthropic, Google, and more.

## Plugin SDK

Third-party apps communicate with ChatBridge via the `@chatbridge/sdk` package:

### Manifest Schema

```json
{
  "id": "my-app",
  "name": "My Education App",
  "version": "1.0.0",
  "description": "An interactive learning tool",
  "url": "https://my-app.example.com",
  "icon": "📱",
  "permissions": ["state_push", "completion"],
  "auth": { "type": "none" },
  "keywords": ["learn", "study"]
}
```

### Building a Third-Party App

1. Install the SDK: `pnpm add @chatbridge/sdk`
2. Initialize in your app:

```typescript
import { ChatBridgeSDK } from '@chatbridge/sdk'

const sdk = new ChatBridgeSDK('my-app')

// Register tools the AI can invoke
sdk.registerTools([
  { name: 'do_thing', description: 'Does a thing', inputSchema: { type: 'object', properties: {} } }
])

// Handle tool invocations
sdk.registerToolHandler('do_thing', async (params) => {
  return { result: 'done' }
})

// Send state updates
sdk.sendStateUpdate({ status: 'active' }, 'App is running')

// Signal completion
sdk.sendCompletion('task_done', { result: 'success' }, 'Task completed')

// Signal ready
sdk.sendReady('My App', '1.0.0')
```

### Protocol Messages

| Direction | Type | Purpose |
|-----------|------|---------|
| Platform → App | INIT | Initialize session with permissions and restored state |
| Platform → App | TOOL_INVOKE | Invoke a registered tool |
| Platform → App | HEARTBEAT_PING | Health check |
| Platform → App | DESTROY | Teardown session |
| App → Platform | READY | Signal app is loaded and ready |
| App → Platform | TOOL_REGISTER | Register available tools |
| App → Platform | TOOL_RESULT | Return tool execution result |
| App → Platform | STATE_UPDATE | Push state changes |
| App → Platform | COMPLETION | Signal task/game completion |
| App → Platform | UI_RESIZE | Request iframe resize |
| App → Platform | ERROR | Report errors |

### Security

- Iframes sandboxed with `allow-scripts` only (never `allow-same-origin`)
- Permissions Policy blocks camera, mic, geolocation, clipboard
- Messages validated against Zod schemas with rate limiting and size limits
- Origin validation on all postMessage events
- OAuth2 uses parent-mediated popup flow (providers block iframe login)

## Deployed Links

- **Main App:** https://chatbridge-main-production.up.railway.app
- **Chess App:** https://chatbridge-chess-production.up.railway.app
- **Classroom App:** https://chatbridge-classroom-production.up.railway.app

## Tech Stack

- **Framework:** Electron + React 19 + TypeScript
- **Build:** Vite (electron-vite)
- **UI:** Mantine + MUI (existing), Tailwind CSS (new code)
- **State:** Jotai atoms, Zustand, React Query
- **Routing:** TanStack Router
- **AI:** Vercel AI SDK v6 (`tool()`, `streamText()`, `generateObject()`)
- **Validation:** Zod schemas throughout
- **Testing:** Vitest (103+ ChatBridge-specific tests)
- **Chess Engine:** Stockfish WASM (lite single-threaded)

## Project Structure

```
chatbox-main/
├── apps/
│   ├── chess/              # Chess app (Stockfish + react-chessboard)
│   └── classroom/          # Google Classroom OAuth2 app
├── packages/
│   └── chatbridge-sdk/     # SDK for third-party app developers
├── src/
│   ├── renderer/
│   │   ├── components/
│   │   │   ├── apps/       # AppIframe, MicroAppRenderer, ActionSuggestions, ManifestAuditor
│   │   │   ├── auth/       # AuthGate, AuthProvider
│   │   │   └── chat/       # Message rendering (content parts switch)
│   │   ├── packages/
│   │   │   ├── app-bridge/ # Tool bridge, manager, routing, manifests
│   │   │   ├── model-calls/# stream-text integration
│   │   │   └── security/   # Manifest auditor (3-layer)
│   │   └── routes/         # TanStack Router file-based routes
│   └── shared/
│       ├── protocol/       # PostMessage protocol types, bridge, errors
│       └── types/          # Content part schemas
├── test/
│   └── evals/              # LLM eval suite (7 grading scenarios)
└── vitest.config.ts
```

## License

GPLv3 — forked from [Chatbox Community Edition](https://github.com/chatboxai/chatbox)
