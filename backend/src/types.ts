import Anthropic from "@anthropic-ai/sdk";

export type AgentStatus = "idle" | "running" | "done" | "error";

export type AgentTemplate =
  | "mission-analyzer"
  | "response-drafter"
  | "effort-estimator";

export interface AgentState {
  id: string;
  name: string;
  status: AgentStatus;
  template: AgentTemplate;
  currentMission: string | null;
  output: string;
  createdAt: string;
  updatedAt: string;
  history: Anthropic.MessageParam[];
  usage?: { inputTokens: number; outputTokens: number; cost: number };
}

export type WSMessage =
  | { type: "agents:init"; agents: AgentState[] }
  | { type: "agent:created"; agent: AgentState }
  | { type: "agent:updated"; agent: AgentState }
  | { type: "agent:deleted"; agentId: string }
  | { type: "agent:token"; agentId: string; token: string }
  | {
      type: "agent:done";
      agentId: string;
      output: string;
      usage?: { inputTokens: number; outputTokens: number; cost: number };
    }
  | { type: "agent:error"; agentId: string; error: string };
