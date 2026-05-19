import { useState, useEffect } from "react";
import { AgentTemplate } from "../store/agentStore";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

const TEMPLATE_OPTIONS: {
  value: AgentTemplate;
  label: string;
  desc: string;
}[] = [
  { value: "general", label: "General", desc: "All-purpose assistant" },
  {
    value: "code-reviewer",
    label: "Code reviewer",
    desc: "Summary, issues, suggestions",
  },
  { value: "doc-writer", label: "Doc writer", desc: "JSDoc-style docs" },
];

interface Props {
  onClose: () => void;
}

export function CreateAgentModal({ onClose }: Props) {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<AgentTemplate>("general");
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
      body: JSON.stringify({ name, template }),
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

        <div
          role="radiogroup"
          aria-label="Agent template"
          style={{ display: "flex", flexDirection: "column", gap: 6 }}
        >
          {TEMPLATE_OPTIONS.map((opt) => {
            const selected = template === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTemplate(opt.value)}
                style={{
                  textAlign: "left",
                  background: selected ? "var(--surface)" : "var(--bg)",
                  border: `1px solid ${
                    selected ? "var(--border-strong)" : "var(--border)"
                  }`,
                  borderRadius: 8,
                  padding: "8px 12px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--text)",
                  }}
                >
                  {opt.label}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                  {opt.desc}
                </div>
              </button>
            );
          })}
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
