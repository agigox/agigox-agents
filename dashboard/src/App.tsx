import { useState } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useAgentStore, Agent } from "./store/agentStore";
import { AgentCard } from "./components/AgentCard";
import { MissionModal } from "./components/MissionModal";
import { CreateAgentModal } from "./components/CreateAgentModal";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

const DEMO_NAMES = [
  "Mission Analyzer",
  "Response Drafter",
  "Effort Estimator",
];

const DEMO_MALT_OFFER = `Mission Freelance React/Next.js, Refonte plateforme SaaS B2B

Bonjour,

Nous sommes une scale-up parisienne de 25 personnes (FinTech B2B) et recherchons un développeur React expérimenté pour la refonte complète de notre dashboard client.

Contexte:
- Plateforme actuelle en AngularJS legacy (4 ans), problèmes de performance et UX critiques
- Stack cible: Next.js 14 (App Router), TypeScript, Tailwind, shadcn/ui, TanStack Query
- Backend Node.js existant en GraphQL, pas de modification nécessaire
- Design system en cours de finalisation par notre designer (Figma)

Mission:
- Refonte du dashboard principal (12 écrans environ)
- Intégration design system depuis Figma
- Mise en place tests Playwright sur les parcours critiques
- Documentation des composants (Storybook souhaité)

Conditions:
- Démarrage souhaité: ASAP (idéalement semaine prochaine)
- Durée estimée: 2-3 mois, possibilité d'extension
- Mode: full remote, sync hebdo en visio
- Budget: 380€ HT/jour (négociable selon profil)
- Process: 1 call de matching puis test technique de 2h

Profil recherché:
- 5+ ans React, dont 2+ ans Next.js App Router
- Maîtrise Figma to Code, pixel-perfect
- Expérience plateforme SaaS B2B appréciée
- Anglais professionnel (calls clients ponctuels en EN)

Merci de candidater avec votre TJM et 2-3 projets similaires.

Cordialement,
Sophie M.`;

export default function App() {
  useWebSocket();

  const agents = useAgentStore((s) => Object.values(s.agents));
  const [missionTarget, setMissionTarget] = useState<Agent | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const running = agents.filter((a) => a.status === "running").length;

  const totalTokens = agents.reduce(
    (sum, a) =>
      sum + (a.usage ? a.usage.inputTokens + a.usage.outputTokens : 0),
    0,
  );
  const totalCost = agents.reduce(
    (sum, a) => sum + (a.usage ? a.usage.cost : 0),
    0,
  );
  const tokenFmt = new Intl.NumberFormat(undefined, { notation: "compact" });

  async function handleDelete(agentId: string) {
    if (!confirm("Delete this agent?")) return;
    await fetch(`${API}/agents/${agentId}`, { method: "DELETE" });
  }

  const demoRunning = agents.some(
    (a) => DEMO_NAMES.includes(a.name) && a.status === "running",
  );

  async function runDemo() {
    const triageAgents = [
      { name: "Mission Analyzer", template: "mission-analyzer" as const },
      { name: "Response Drafter", template: "response-drafter" as const },
      { name: "Effort Estimator", template: "effort-estimator" as const },
    ];

    for (const config of triageAgents) {
      const res = await fetch(`${API}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const agent = await res.json();
      // Fire and forget so all three stream in parallel on the same offer
      fetch(`${API}/agents/${agent.id}/mission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mission: DEMO_MALT_OFFER }),
      });
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--surface)" }}>
      {/* Header */}
      <header
        style={{
          background: "var(--bg)",
          borderBottom: "1px solid var(--border)",
          height: 52,
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: "-0.3px",
              color: "var(--text)",
            }}
          >
            Agents
          </span>
          <span
            style={{
              fontSize: 11,
              color: "var(--text-3)",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 20,
              padding: "2px 8px",
            }}
          >
            {agents.length} total · {running} running ·{" "}
            {tokenFmt.format(totalTokens)} tokens · ${totalCost.toFixed(2)}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={runDemo}
            disabled={demoRunning}
            style={{
              background: "transparent",
              color: "var(--text-3)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 500,
              cursor: demoRunning ? "not-allowed" : "pointer",
              letterSpacing: "-0.1px",
            }}
          >
            Run demo
          </button>
          <button
            onClick={() => setShowCreate(true)}
            style={{
              background: "#111",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              letterSpacing: "-0.1px",
            }}
          >
            + New agent
          </button>
        </div>
      </header>

      {/* Grid */}
      <main style={{ padding: 24 }}>
        {agents.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              color: "var(--text-3)",
              marginTop: 100,
            }}
          >
            <div style={{ fontSize: 14 }}>No agents yet.</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              Create one above or send /create from Telegram.
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 16,
            }}
          >
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onAssignMission={setMissionTarget}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>

      {missionTarget && (
        <MissionModal
          agent={missionTarget}
          onClose={() => setMissionTarget(null)}
        />
      )}
      {showCreate && <CreateAgentModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
