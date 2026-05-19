import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import { AgentState, AgentTemplate } from "./types";
import { saveAgent, getAgent, getAllAgents, deleteAgent } from "./redisClient";
import { broadcast } from "./broadcast";
import { addDailyUsage } from "./usageGuard";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// claude-sonnet-4-5 standard pricing, USD per million tokens.
// Re-verify on the Anthropic pricing page if the model changes.
const PRICING = { inputPerMTok: 3, outputPerMTok: 15 };

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

const TEMPLATE_PROMPTS: Record<AgentTemplate, (name: string) => string> = {
  general: (n) => `You are agent "${n}". Complete missions precisely and thoroughly.`,
  "code-reviewer": (n) =>
    `You are "${n}", a senior code reviewer. For any code submitted, return: 1) Summary, 2) Issues (severity, line, fix), 3) Suggestions. Be terse, no preamble.`,
  "doc-writer": (n) =>
    `You are "${n}", a technical writer. Generate JSDoc-style docs for the code: description, @param, @returns, one short example.`,
};

export async function createAgent(
  name: string,
  template: AgentTemplate = "general",
): Promise<AgentState> {
  const agent: AgentState = {
    id: uuidv4(),
    name,
    status: "idle",
    template,
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
    model: MODEL,
    max_tokens: 4096,
    system: TEMPLATE_PROMPTS[agent.template](agent.name),
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

  const finalMsg = await stream.finalMessage();
  const inputTokens = finalMsg.usage.input_tokens;
  const outputTokens = finalMsg.usage.output_tokens;
  const cost =
    (inputTokens * PRICING.inputPerMTok +
      outputTokens * PRICING.outputPerMTok) /
    1_000_000;
  const usage = { inputTokens, outputTokens, cost };
  await addDailyUsage(inputTokens + outputTokens);

  const updated = await getAgent(agent.id);
  if (!updated) return;
  updated.status = "done";
  updated.output = fullOutput;
  updated.usage = usage;
  updated.history.push({ role: "assistant", content: fullOutput });
  updated.updatedAt = new Date().toISOString();
  await saveAgent(updated);
  broadcast({
    type: "agent:done",
    agentId: agent.id,
    output: fullOutput,
    usage,
  });
}

export async function listAgents() {
  return getAllAgents();
}
export async function removeAgent(agentId: string) {
  await deleteAgent(agentId);
  broadcast({ type: "agent:deleted", agentId });
}
