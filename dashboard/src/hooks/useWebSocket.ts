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
