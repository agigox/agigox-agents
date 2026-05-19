import { create } from "zustand";

export type AgentStatus = "idle" | "running" | "done" | "error";

export type AgentTemplate =
  | "mission-analyzer"
  | "response-drafter"
  | "effort-estimator";

export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  template: AgentTemplate;
  currentMission: string | null;
  output: string;
  updatedAt: string;
  usage?: { inputTokens: number; outputTokens: number; cost: number };
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
