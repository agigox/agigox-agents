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
