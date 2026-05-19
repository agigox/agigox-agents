# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Real-time dashboard for spawning Claude agents, assigning missions, and streaming their output live. Two deployables: a Node/TypeScript backend and a React/Vite dashboard. Control plane is dual: a web UI and a Telegram bot, both driving the same agent functions. `PLAN.md` is the original full implementation spec.

## Commands

Backend (`cd backend`):
- `npm run dev` , tsx watch on `src/index.ts` (hot reload)
- `npm run build` , `tsc` to `dist/`
- `npm start` , run compiled `dist/index.js`

Dashboard (`cd dashboard`):
- `npm run dev` , Vite dev server
- `npm run build` , `tsc -b && vite build` to `dist/`
- `npm run preview` , serve built output

Infra:
- `docker compose up` , starts Redis + backend only (no dashboard service)
- No test or lint scripts exist in either package.

## Runtime prerequisites

- Backend hard-depends on Redis at `REDIS_URL` (default `redis://localhost:6379`). Without a reachable Redis, every REST/WS/Telegram action fails, the process does not crash but does nothing useful. Start Redis (`docker compose up redis`) before the backend.
- `backend/.env` keys: `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN` (optional, bot disabled if unset), `REDIS_URL`, `PORT` (default 3001), `DASHBOARD_ORIGIN` (CORS allow-origin, `*` if unset).
- Dashboard env: `VITE_API_URL` and `VITE_WS_URL` (default `http://localhost:3001` / `ws://localhost:3001`).

## Architecture

### One HTTP server, two protocols
`backend/src/index.ts` creates a single `http.createServer(app)` and attaches both the Express REST routes and a `ws` `WebSocketServer` to it. They share one port. On WS connect, the server replays full state via an `agents:init` message sourced from Redis.

### Broadcast decoupling
`broadcast.ts` holds a module-level `clients` Set. `index.ts` injects the live WS client set via `registerClients()` at startup. This lets `agentManager.ts` call `broadcast()` to push updates without importing the WS server, avoiding a circular dependency. Any agent state change is the pattern: mutate, `saveAgent()` to Redis, then `broadcast()` a typed `WSMessage`.

### Redis is the only store
No in-memory agent state. `redisClient.ts` uses `agent:<id>` string keys plus an `agents:all` set for enumeration. `runAgent()` deliberately re-fetches the agent from Redis before its final write so a delete or concurrent change during streaming is not clobbered by stale state.

### Agent execution
`agentManager.assignMission()` flips status to `running`, persists, then fires `runAgent()` without awaiting (errors caught async and broadcast as `agent:error`). `runAgent()` streams `anthropic.messages.stream`, emitting one `agent:token` broadcast per text delta, then a terminal `agent:done`. Model is hardcoded `claude-sonnet-4-5` in `agentManager.ts`. Conversation `history` accumulates across missions per agent.

### Dual control plane
REST (`index.ts`) and Telegram (`telegramBot.ts`) are thin wrappers over the same `agentManager` functions (`createAgent`, `assignMission`, `listAgents`, `removeAgent`). Add agent capabilities in `agentManager.ts`, then expose via both surfaces.

### Frontend state flow
`useWebSocket.ts` opens one WS connection with 2s auto-reconnect and routes each `WSMessage` into the zustand store (`store/agentStore.ts`), keyed by agent id. `agent:token` appends to `output` for live streaming. REST is used only for mutations (create/mission/delete) via `VITE_API_URL`; all state updates arrive over WS. The two `AgentStatus`/`Agent` type definitions in `backend/src/types.ts` and `dashboard/src/store/agentStore.ts` are duplicated and must be kept in sync manually.

## Deployment split

Dashboard targets Vercel (`dashboard/vercel.json`, SPA rewrite to `index.html`). Backend cannot run on Vercel because serverless has no persistent WebSocket, host it on Railway/Render. `docker-compose.yml` is backend + Redis only; the dashboard is not containerized.
