# Agent Dashboard — Implementation Plan

# (Updated: Vercel frontend · Black & White design)

<!-- Project: agent-dashboard -->
<!-- Stack: Node.js + TypeScript · React + TypeScript · Redis · WebSocket · Telegram -->

---

## Architecture Note

```
┌─────────────────────┐     ┌──────────────────────────┐
│  Dashboard (React)  │────▶│  Backend (Node.js + WS)  │
│  Hosted on Vercel   │     │  Hosted on Railway/Render │
└─────────────────────┘     └──────────────────────────┘
                                         │
                                    ┌────▼─────┐
                                    │  Redis   │
                                    └──────────┘
```

> ⚠️ Vercel runs serverless functions — no persistent WebSocket support.
> Host the backend on Railway (https://railway.app) or Render (https://render.com).
> Both have free tiers and support WebSockets + Redis natively.

---

## Project Structure to Create

```
agent-dashboard/
├── backend/
│   ├── src/
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── agentManager.ts
│   │   ├── wsServer.ts
│   │   ├── telegramBot.ts
│   │   └── redisClient.ts
│   ├── .env.example
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── dashboard/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── index.css
│   │   ├── store/
│   │   │   └── agentStore.ts
│   │   ├── hooks/
│   │   │   └── useWebSocket.ts
│   │   └── components/
│   │       ├── AgentCard.tsx
│   │       ├── MissionModal.tsx
│   │       └── CreateAgentModal.tsx
│   ├── vercel.json
│   ├── .env.example
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
└── docker-compose.yml
```

---

## Task 1 — Backend package.json

**File to create:** `backend/package.json`

```json
{
  "name": "agent-dashboard-backend",
  "version": "1.0.0",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "express": "^4.18.2",
    "grammy": "^1.21.1",
    "ioredis": "^5.3.2",
    "ws": "^8.16.0",
    "dotenv": "^16.4.1",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/ws": "^8.5.10",
    "@types/uuid": "^9.0.7",
    "@types/node": "^20.11.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3"
  }
}
```

---

## Task 2 — Backend tsconfig.json

**File to create:** `backend/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

---

## Task 3 — Backend .env.example

**File to create:** `backend/.env.example`

```
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=123456789:ABC...
REDIS_URL=redis://localhost:6379
PORT=3001
DASHBOARD_ORIGIN=https://your-app.vercel.app
```

---

## Task 4 — Shared types

**File to create:** `backend/src/types.ts`

```typescript
import Anthropic from "@anthropic-ai/sdk";

export type AgentStatus = "idle" | "running" | "done" | "error";

export interface AgentState {
  id: string;
  name: string;
  status: AgentStatus;
  currentMission: string | null;
  output: string;
  createdAt: string;
  updatedAt: string;
  history: Anthropic.MessageParam[];
}

export type WSMessage =
  | { type: "agents:init"; agents: AgentState[] }
  | { type: "agent:created"; agent: AgentState }
  | { type: "agent:updated"; agent: AgentState }
  | { type: "agent:deleted"; agentId: string }
  | { type: "agent:token"; agentId: string; token: string }
  | { type: "agent:done"; agentId: string; output: string }
  | { type: "agent:error"; agentId: string; error: string };
```

---

## Task 5 — Redis client

**File to create:** `backend/src/redisClient.ts`

```typescript
import Redis from "ioredis";
import { AgentState } from "./types";

export const redis = new Redis(
  process.env.REDIS_URL || "redis://localhost:6379",
);

const KEY = (id: string) => `agent:${id}`;
const ALL = "agents:all";

export async function saveAgent(agent: AgentState): Promise<void> {
  await redis.set(KEY(agent.id), JSON.stringify(agent));
  await redis.sadd(ALL, agent.id);
}

export async function getAgent(id: string): Promise<AgentState | null> {
  const raw = await redis.get(KEY(id));
  return raw ? JSON.parse(raw) : null;
}

export async function getAllAgents(): Promise<AgentState[]> {
  const ids = await redis.smembers(ALL);
  if (!ids.length) return [];
  const agents = await Promise.all(ids.map(getAgent));
  return agents.filter(Boolean) as AgentState[];
}

export async function deleteAgent(id: string): Promise<void> {
  await redis.del(KEY(id));
  await redis.srem(ALL, id);
}
```

---

## Task 6 — Agent manager

**File to create:** `backend/src/agentManager.ts`

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import { AgentState } from "./types";
import { saveAgent, getAgent, getAllAgents, deleteAgent } from "./redisClient";
import { broadcast } from "./wsServer";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function createAgent(name: string): Promise<AgentState> {
  const agent: AgentState = {
    id: uuidv4(),
    name,
    status: "idle",
    currentMission: null,
    output: "",
    history: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveAgent(agent);
  broadcast({ type: "agent:created", agent });
  return agent;
}

export async function assignMission(
  agentId: string,
  mission: string,
): Promise<void> {
  const agent = await getAgent(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);
  if (agent.status === "running")
    throw new Error(`Agent ${agentId} is already running`);

  agent.status = "running";
  agent.currentMission = mission;
  agent.output = "";
  agent.updatedAt = new Date().toISOString();
  agent.history.push({ role: "user", content: mission });

  await saveAgent(agent);
  broadcast({ type: "agent:updated", agent });

  runAgent(agent).catch(async (err) => {
    const current = await getAgent(agentId);
    if (!current) return;
    current.status = "error";
    current.updatedAt = new Date().toISOString();
    await saveAgent(current);
    broadcast({ type: "agent:error", agentId, error: String(err) });
  });
}

async function runAgent(agent: AgentState): Promise<void> {
  let fullOutput = "";

  const stream = await anthropic.messages.stream({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    system: `You are agent "${agent.name}". Complete missions precisely and thoroughly.`,
    messages: agent.history,
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      const token = event.delta.text;
      fullOutput += token;
      broadcast({ type: "agent:token", agentId: agent.id, token });
    }
  }

  const updated = await getAgent(agent.id);
  if (!updated) return;
  updated.status = "done";
  updated.output = fullOutput;
  updated.history.push({ role: "assistant", content: fullOutput });
  updated.updatedAt = new Date().toISOString();
  await saveAgent(updated);
  broadcast({ type: "agent:done", agentId: agent.id, output: fullOutput });
}

export async function listAgents() {
  return getAllAgents();
}
export async function removeAgent(agentId: string) {
  await deleteAgent(agentId);
  broadcast({ type: "agent:deleted", agentId });
}
```

---

## Task 7 — Telegram bot

**File to create:** `backend/src/telegramBot.ts`

```typescript
import { Bot } from "grammy";
import {
  createAgent,
  assignMission,
  listAgents,
  removeAgent,
} from "./agentManager";

export function initTelegramBot(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN not set — bot disabled");
    return;
  }

  const bot = new Bot(token);

  bot.command("start", (ctx) =>
    ctx.reply(
      "🤖 Agent Dashboard\n\n/create <n>\n/mission <id> <task>\n/list\n/delete <id>",
    ),
  );
  bot.command("create", async (ctx) => {
    const name = ctx.match.trim();
    if (!name) return ctx.reply("Usage: /create <n>");
    const agent = await createAgent(name);
    ctx.reply(`✅ Created\nID: ${agent.id}\nName: ${agent.name}`);
  });
  bot.command("mission", async (ctx) => {
    const [agentId, ...rest] = ctx.match.trim().split(" ");
    const mission = rest.join(" ");
    if (!agentId || !mission) return ctx.reply("Usage: /mission <id> <task>");
    await assignMission(agentId, mission);
    ctx.reply(`🚀 Mission assigned to ${agentId}`);
  });
  bot.command("list", async (ctx) => {
    const agents = await listAgents();
    if (!agents.length) return ctx.reply("No agents.");
    ctx.reply(
      agents.map((a) => `• [${a.status}] ${a.name}\n  ${a.id}`).join("\n\n"),
    );
  });
  bot.command("delete", async (ctx) => {
    const agentId = ctx.match.trim();
    if (!agentId) return ctx.reply("Usage: /delete <id>");
    await removeAgent(agentId);
    ctx.reply(`🗑 Deleted ${agentId}`);
  });

  bot.start();
  console.log("Telegram bot started");
}
```

---

## Task 8 — Express + WebSocket entry point

**File to create:** `backend/src/index.ts`

> NOTE: Use a single HTTP server for both Express and WebSocket.
> Railway only exposes one port — this avoids the two-port problem.

```typescript
import "dotenv/config";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import express from "express";
import { initTelegramBot } from "./telegramBot";
import {
  createAgent,
  assignMission,
  listAgents,
  removeAgent,
} from "./agentManager";
import { getAllAgents } from "./redisClient";
import { WSMessage } from "./types";

const app = express();
app.use(express.json());

const ORIGIN = process.env.DASHBOARD_ORIGIN || "*";
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  next();
});
app.options("*", (_req, res) => res.sendStatus(204));

app.get("/agents", async (_req, res) => res.json(await listAgents()));
app.post("/agents", async (req, res) =>
  res.json(await createAgent(req.body.name)),
);
app.post("/agents/:id/mission", async (req, res) => {
  await assignMission(req.params.id, req.body.mission);
  res.json({ ok: true });
});
app.delete("/agents/:id", async (req, res) => {
  await removeAgent(req.params.id);
  res.json({ ok: true });
});

// Single HTTP server shared by Express + WS
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Export broadcast so agentManager can use it
export function broadcast(message: WSMessage): void {
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}

wss.on("connection", async (ws) => {
  const agents = await getAllAgents();
  ws.send(JSON.stringify({ type: "agents:init", agents }));
});

initTelegramBot();

const PORT = Number(process.env.PORT) || 3001;
server.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
```

**File to update:** `backend/src/wsServer.ts` — replace with re-export from index

```typescript
// wsServer.ts is replaced by the broadcast export in index.ts.
// Import broadcast directly from './index' in agentManager if needed,
// or pass it as a dependency. Simplest: move broadcast to a shared module.
```

> IMPORTANT: To avoid circular imports, create `backend/src/broadcast.ts`:

```typescript
// backend/src/broadcast.ts
import { WebSocket } from "ws";
import { WSMessage } from "./types";

let clients: Set<WebSocket> = new Set();

export function registerClients(set: Set<WebSocket>) {
  clients = set;
}

export function broadcast(message: WSMessage): void {
  const data = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}
```

Then in `index.ts`: `registerClients(wss.clients as Set<WebSocket>)`
And in `agentManager.ts`: `import { broadcast } from './broadcast'`

---

## Task 9 — Backend Dockerfile

**File to create:** `backend/Dockerfile`

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
CMD ["npm", "run", "start"]
```

---

## Task 10 — Dashboard scaffolding

**Run:**

```bash
cd dashboard
npm create vite@latest . -- --template react-ts
npm i zustand
npm i -D tailwindcss @tailwindcss/vite
```

**File to create:** `dashboard/vite.config.ts`

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

**File to update:** `dashboard/src/index.css`

```css
@import "tailwindcss";

*,
*::before,
*::after {
  box-sizing: border-box;
}

:root {
  --bg: #ffffff;
  --surface: #f7f7f7;
  --border: #e8e8e8;
  --border-strong: #d0d0d0;
  --text: #111111;
  --text-2: #555555;
  --text-3: #999999;
  --terminal-bg: #111111;
  --terminal-text: #e5e5e5;
  --terminal-cursor: #888888;
}

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--surface);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: #d4d4d4;
  border-radius: 2px;
}
```

---

## Task 11 — Dashboard .env files

**File to create:** `dashboard/.env.example`

```
VITE_API_URL=https://your-backend.railway.app
VITE_WS_URL=wss://your-backend.railway.app
```

**File to create:** `dashboard/.env.local` (gitignored — for local dev)

```
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001
```

---

## Task 12 — vercel.json

**File to create:** `dashboard/vercel.json`

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

---

## Task 13 — Zustand store

**File to create:** `dashboard/src/store/agentStore.ts`

```typescript
import { create } from "zustand";

export type AgentStatus = "idle" | "running" | "done" | "error";

export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  currentMission: string | null;
  output: string;
  updatedAt: string;
}

interface AgentStore {
  agents: Record<string, Agent>;
  setAgents: (agents: Agent[]) => void;
  upsertAgent: (agent: Agent) => void;
  deleteAgent: (id: string) => void;
  appendToken: (agentId: string, token: string) => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  agents: {},
  setAgents: (agents) =>
    set({ agents: Object.fromEntries(agents.map((a) => [a.id, a])) }),
  upsertAgent: (agent) =>
    set((s) => ({ agents: { ...s.agents, [agent.id]: agent } })),
  deleteAgent: (id) =>
    set((s) => {
      const n = { ...s.agents };
      delete n[id];
      return { agents: n };
    }),
  appendToken: (agentId, token) =>
    set((s) => {
      const a = s.agents[agentId];
      if (!a) return s;
      return {
        agents: { ...s.agents, [agentId]: { ...a, output: a.output + token } },
      };
    }),
}));
```

---

## Task 14 — useWebSocket hook

**File to create:** `dashboard/src/hooks/useWebSocket.ts`

```typescript
import { useEffect, useRef } from "react";
import { useAgentStore } from "../store/agentStore";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001";

export function useWebSocket() {
  const ws = useRef<WebSocket | null>(null);
  const { setAgents, upsertAgent, deleteAgent, appendToken } = useAgentStore();

  useEffect(() => {
    function connect() {
      ws.current = new WebSocket(WS_URL);
      ws.current.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        const store = useAgentStore.getState();
        switch (msg.type) {
          case "agents:init":
            setAgents(msg.agents);
            break;
          case "agent:created":
          case "agent:updated":
            upsertAgent(msg.agent);
            break;
          case "agent:deleted":
            deleteAgent(msg.agentId);
            break;
          case "agent:token":
            appendToken(msg.agentId, msg.token);
            break;
          case "agent:done":
            upsertAgent({
              ...store.agents[msg.agentId],
              status: "done",
              output: msg.output,
            });
            break;
          case "agent:error":
            upsertAgent({ ...store.agents[msg.agentId], status: "error" });
            break;
        }
      };
      ws.current.onclose = () => setTimeout(connect, 2000);
    }
    connect();
    return () => ws.current?.close();
  }, []);
}
```

---

## Task 15 — AgentCard component

**File to create:** `dashboard/src/components/AgentCard.tsx`

Design rules:

- White card, 1px `var(--border)` border, 12px radius
- Status: small dot (gray shades only) + text label
- Terminal: `var(--terminal-bg)` black bg, monospace, auto-scrolls
- Primary button: black bg / white text
- Secondary button: transparent / gray text, hover → black border + text

```tsx
import { useRef, useEffect } from "react";
import { Agent } from "../store/agentStore";

const STATUS_DOT: Record<string, string> = {
  idle: "background:#d4d4d4",
  running: "background:#111;animation:pulse 1.2s ease-in-out infinite",
  done: "background:#111",
  error: "background:#bbb",
};
const STATUS_LABEL: Record<string, string> = {
  idle: "Idle",
  running: "Running…",
  done: "Done",
  error: "Error",
};

interface Props {
  agent: Agent;
  onAssignMission: (agent: Agent) => void;
  onDelete: (agentId: string) => void;
}

export function AgentCard({ agent, onAssignMission, onDelete }: Props) {
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (outputRef.current)
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [agent.output]);

  const isRunning = agent.status === "running";

  return (
    <div
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 8,
        }}
      >
        <div>
          <div
            style={{
              fontWeight: 600,
              fontSize: 14,
              color: "var(--text)",
              lineHeight: 1.4,
            }}
          >
            {agent.name}
          </div>
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              color: "var(--text-3)",
              marginTop: 1,
            }}
          >
            {agent.id.slice(0, 12)}…
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 20,
            padding: "3px 9px",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              display: "inline-block",
              style: STATUS_DOT[agent.status],
              ...{
                style: undefined,
                ...(() => {
                  const s: Record<string, string> = {};
                  STATUS_DOT[agent.status].split(";").forEach((r) => {
                    const [k, v] = r.split(":");
                    if (k && v) s[k.trim()] = v.trim();
                  });
                  return s;
                })(),
              },
            }}
          />
          <span style={{ fontSize: 12, color: "var(--text-2)" }}>
            {STATUS_LABEL[agent.status]}
          </span>
        </div>
      </div>

      {/* Current mission */}
      {agent.currentMission && (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-2)",
            background: "var(--surface)",
            borderLeft: "2px solid var(--border-strong)",
            borderRadius: "0 4px 4px 0",
            padding: "5px 10px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {agent.currentMission}
        </div>
      )}

      {/* Terminal */}
      <pre
        ref={outputRef}
        style={{
          background: "var(--terminal-bg)",
          color: "var(--terminal-text)",
          fontFamily: '"SF Mono","Fira Code",monospace',
          fontSize: 12,
          lineHeight: 1.65,
          borderRadius: 8,
          padding: "12px 14px",
          margin: 0,
          minHeight: 120,
          maxHeight: 200,
          overflowY: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {agent.output || (
          <span style={{ color: "#444" }}>Waiting for mission…</span>
        )}
      </pre>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => onAssignMission(agent)}
          disabled={isRunning}
          style={{
            flex: 1,
            background: isRunning ? "var(--surface)" : "#111",
            color: isRunning ? "var(--text-3)" : "#fff",
            border: `1px solid ${isRunning ? "var(--border)" : "#111"}`,
            borderRadius: 7,
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 500,
            cursor: isRunning ? "not-allowed" : "pointer",
            transition: "all 0.15s",
          }}
        >
          Assign mission
        </button>
        <button
          onClick={() => onDelete(agent.id)}
          style={{
            background: "transparent",
            color: "var(--text-3)",
            border: "1px solid var(--border)",
            borderRadius: 7,
            padding: "8px 12px",
            fontSize: 13,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--text)";
            e.currentTarget.style.borderColor = "var(--border-strong)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-3)";
            e.currentTarget.style.borderColor = "var(--border)";
          }}
        >
          Delete
        </button>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  );
}
```

---

## Task 16 — MissionModal

**File to create:** `dashboard/src/components/MissionModal.tsx`

```tsx
import { useState, useEffect } from "react";
import { Agent } from "../store/agentStore";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

interface Props {
  agent: Agent;
  onClose: () => void;
}

export function MissionModal({ agent, onClose }: Props) {
  const [mission, setMission] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  async function submit() {
    if (!mission.trim() || loading) return;
    setLoading(true);
    await fetch(`${API}/agents/${agent.id}/mission`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mission }),
    });
    setLoading(false);
    onClose();
  }

  const disabled = loading || !mission.trim();

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: 24,
          width: "100%",
          maxWidth: 480,
          margin: "0 16px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text)" }}>
            Assign mission
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
            Agent: {agent.name}
          </div>
        </div>

        <textarea
          autoFocus
          value={mission}
          onChange={(e) => setMission(e.target.value)}
          placeholder="Describe the mission…"
          onKeyDown={(e) => e.key === "Enter" && e.metaKey && submit()}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 13,
            lineHeight: 1.6,
            resize: "vertical",
            minHeight: 120,
            color: "var(--text)",
            background: "var(--surface)",
            outline: "none",
            fontFamily: "inherit",
            width: "100%",
            transition: "border-color 0.15s",
          }}
          onFocus={(e) =>
            (e.currentTarget.style.borderColor = "var(--border-strong)")
          }
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
        />

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            ⌘ Enter to send
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 7,
                padding: "7px 14px",
                fontSize: 13,
                color: "var(--text-2)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={disabled}
              style={{
                background: disabled ? "var(--surface)" : "#111",
                color: disabled ? "var(--text-3)" : "#fff",
                border: `1px solid ${disabled ? "var(--border)" : "#111"}`,
                borderRadius: 7,
                padding: "7px 16px",
                fontSize: 13,
                fontWeight: 500,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

## Task 17 — CreateAgentModal

**File to create:** `dashboard/src/components/CreateAgentModal.tsx`

```tsx
import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

interface Props {
  onClose: () => void;
}

export function CreateAgentModal({ onClose }: Props) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  async function submit() {
    if (!name.trim() || loading) return;
    setLoading(true);
    await fetch(`${API}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setLoading(false);
    onClose();
  }

  const disabled = loading || !name.trim();

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: 24,
          width: "100%",
          maxWidth: 360,
          margin: "0 16px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text)" }}>
          New agent
        </div>

        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Agent name…"
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 14,
            color: "var(--text)",
            background: "var(--surface)",
            outline: "none",
            fontFamily: "inherit",
            width: "100%",
            transition: "border-color 0.15s",
          }}
          onFocus={(e) =>
            (e.currentTarget.style.borderColor = "var(--border-strong)")
          }
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
        />

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 7,
              padding: "7px 14px",
              fontSize: 13,
              color: "var(--text-2)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={disabled}
            style={{
              background: disabled ? "var(--surface)" : "#111",
              color: disabled ? "var(--text-3)" : "#fff",
              border: `1px solid ${disabled ? "var(--border)" : "#111"}`,
              borderRadius: 7,
              padding: "7px 16px",
              fontSize: 13,
              fontWeight: 500,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## Task 18 — App.tsx

**File to create:** `dashboard/src/App.tsx`

```tsx
import { useState } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useAgentStore, Agent } from "./store/agentStore";
import { AgentCard } from "./components/AgentCard";
import { MissionModal } from "./components/MissionModal";
import { CreateAgentModal } from "./components/CreateAgentModal";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

export default function App() {
  useWebSocket();

  const agents = useAgentStore((s) => Object.values(s.agents));
  const [missionTarget, setMissionTarget] = useState<Agent | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const running = agents.filter((a) => a.status === "running").length;

  async function handleDelete(agentId: string) {
    if (!confirm("Delete this agent?")) return;
    await fetch(`${API}/agents/${agentId}`, { method: "DELETE" });
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--surface)" }}>
      {/* Header */}
      <header
        style={{
          background: "var(--bg)",
          borderBottom: "1px solid var(--border)",
          height: 52,
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: "-0.3px",
              color: "var(--text)",
            }}
          >
            Agents
          </span>
          <span
            style={{
              fontSize: 11,
              color: "var(--text-3)",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 20,
              padding: "2px 8px",
            }}
          >
            {agents.length} total · {running} running
          </span>
        </div>

        <button
          onClick={() => setShowCreate(true)}
          style={{
            background: "#111",
            color: "#fff",
            border: "none",
            borderRadius: 7,
            padding: "6px 14px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            letterSpacing: "-0.1px",
          }}
        >
          + New agent
        </button>
      </header>

      {/* Grid */}
      <main style={{ padding: 24 }}>
        {agents.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              color: "var(--text-3)",
              marginTop: 100,
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 10, letterSpacing: -2 }}>
              — —
            </div>
            <div style={{ fontSize: 14 }}>No agents yet.</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              Create one above or send /create from Telegram.
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 16,
            }}
          >
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onAssignMission={setMissionTarget}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>

      {missionTarget && (
        <MissionModal
          agent={missionTarget}
          onClose={() => setMissionTarget(null)}
        />
      )}
      {showCreate && <CreateAgentModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
```

---

## Task 19 — Docker Compose (local dev)

**File to create:** `docker-compose.yml`

```yaml
version: "3.9"
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  backend:
    build: ./backend
    ports:
      - "3001:3001"
    env_file: ./backend/.env
    environment:
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis

volumes:
  redis_data:
```

---

## How to Run Locally

```bash
# Terminal 1 — Redis + backend
cp backend/.env.example backend/.env  # fill in your keys
docker compose up redis -d
cd backend && npm install && npm run dev

# Terminal 2 — Dashboard
cd dashboard && npm install && npm run dev
# Open http://localhost:5173
```

---

## How to Deploy

### 1. Backend → Railway

```bash
npm i -g @railway/cli
railway login
cd backend
railway init
railway up
```

In Railway dashboard:

- Add **Redis** plugin (auto-sets `REDIS_URL`)
- Add env vars: `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `DASHBOARD_ORIGIN`
- Copy the public URL (e.g. `https://agent-dashboard-backend.railway.app`)

### 2. Dashboard → Vercel

```bash
npm i -g vercel
cd dashboard
vercel
```

In Vercel dashboard → Settings → Environment Variables:

```
VITE_API_URL  = https://agent-dashboard-backend.railway.app
VITE_WS_URL   = wss://agent-dashboard-backend.railway.app
```

Then **redeploy** for env vars to take effect.

Also update backend `.env`:

```
DASHBOARD_ORIGIN=https://your-app.vercel.app
```

---

## Risks & Notes

- **Single port WS**: backend uses one HTTP server for both Express and WS (avoids Railway's single-port limitation).
- **Circular import**: use `broadcast.ts` as a shared module to avoid `index.ts ↔ agentManager.ts` circular dependency.
- **Agent history**: trim `history[]` to last 10 entries to stay within Claude's context window.
- **No auth**: add a shared secret header between dashboard → backend before going public.
- **CORS**: set `DASHBOARD_ORIGIN` to your exact Vercel URL in production, not `*`.
- **wss:// vs ws://**: local dev uses `ws://`, production must use `wss://` (Railway provides HTTPS/WSS by default).
