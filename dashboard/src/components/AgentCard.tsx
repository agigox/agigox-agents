import { useRef, useEffect, CSSProperties } from "react";
import { Agent } from "../store/agentStore";

const STATUS_DOT: Record<string, CSSProperties> = {
  idle: { background: "#d4d4d4" },
  running: {
    background: "#111",
    animation: "pulse 1.2s ease-in-out infinite",
  },
  done: { background: "#111" },
  error: { background: "#bbb" },
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
              ...STATUS_DOT[agent.status],
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
