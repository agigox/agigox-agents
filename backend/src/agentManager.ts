import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import { AgentState } from "./types";
import { saveAgent, getAgent, getAllAgents, deleteAgent } from "./redisClient";
import { broadcast } from "./broadcast";

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
    console.error(`[agent ${agentId}] runAgent failed:`, err);
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
