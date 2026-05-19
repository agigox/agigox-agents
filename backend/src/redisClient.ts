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
  if (!raw) return null;
  const agent = JSON.parse(raw) as AgentState;
  // Back-compat: legacy agents (no template, or pre-freelance generics like
  // "general") normalize to the default triage template on read.
  const VALID: AgentState["template"][] = [
    "mission-analyzer",
    "response-drafter",
    "effort-estimator",
  ];
  if (!VALID.includes(agent.template)) agent.template = "mission-analyzer";
  return agent;
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
