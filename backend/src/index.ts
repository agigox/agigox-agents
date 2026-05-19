import "dotenv/config";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import express from "express";
import rateLimit from "express-rate-limit";
import { initTelegramBot } from "./telegramBot";
import {
  createAgent,
  assignMission,
  listAgents,
  removeAgent,
} from "./agentManager";
import { getAllAgents } from "./redisClient";
import { registerClients } from "./broadcast";
import { getDailyTotal, dailyCap } from "./usageGuard";

const app = express();
// Behind Railway/Render the client IP is in X-Forwarded-For; trust one proxy
// hop so the rate limiter keys on the real client, not the proxy.
app.set("trust proxy", 1);
app.use(express.json());

const missionLimiter = rateLimit({ windowMs: 60_000, limit: 5 });

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
  res.json(await createAgent(req.body.name, req.body.template ?? "general")),
);
app.post("/agents/:id/mission", missionLimiter, async (req, res) => {
  if ((await getDailyTotal()) > dailyCap()) {
    return res.status(429).json({
      error: "Daily demo limit reached. Fork the repo to keep playing.",
    });
  }
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

// Hand the live client set to broadcast.ts so agentManager can reach it
registerClients(wss.clients as Set<WebSocket>);

wss.on("connection", async (ws) => {
  const agents = await getAllAgents();
  ws.send(JSON.stringify({ type: "agents:init", agents }));
});

initTelegramBot();

const PORT = Number(process.env.PORT) || 3001;
server.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
