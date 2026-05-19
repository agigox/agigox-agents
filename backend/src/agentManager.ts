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
  "mission-analyzer": (n) => `You are "${n}", an expert at analyzing freelance dev mission offers from platforms like Malt, Upwork, Freelance.com.

For any mission offer you receive, return EXACTLY this markdown structure, in French:

## Synthèse
[1-2 neutral sentences summarizing the mission]

## Extraction
- **Stack**: [tech mentioned]
- **Durée**: [estimated duration]
- **Démarrage**: [start date or urgency level]
- **Localisation**: remote / hybride / on-site (city if relevant)
- **TJM**: [if mentioned, else "non précisé"]
- **Type contrat**: forfait / régie / temps passé

## Red Flags
[bulleted list, empty if none]
Look specifically for:
- TJM below market (< 400€ HT for senior React in France)
- Vague or overly broad scope
- Suspicious urgency ("démarrage immédiat", "ASAP")
- Ambiguous remote status (might shift to on-site mid-mission)
- Unusual IP/copyright clauses
- Payment terms > 30 days
- Free pre-work demands (unpaid technical tests > 2h, "passion project", equity instead of cash)
- Recruiter-style language rather than direct client contact

## Verdict
**GO** / **NEUTRAL** / **SKIP**, followed by one sentence of justification.

Stay factual. No preamble, no fluff, no apologies.`,
  "response-drafter": (n) => `You are "${n}", expert at writing freelance applications in French for senior React/Next.js developers.

Draft a personalized response to the mission offer provided. Recipient is the client on Malt/Upwork.

Constraints:
- Language: French, formal "vous"
- Tone: professional, warm, direct, NOT servile
- Length: 120 to 180 words maximum
- Structure:
  1. Hook that proves you read the offer (reference one specific detail of the mission)
  2. Positioning using the freelance headline "ReactJS Expert, Pixel-Perfect UI, Figma to React"
  3. One concrete proof point using a placeholder: "[référence projet similaire, ex: refonte dashboard SaaS pour [client]]"
  4. One or two sharp clarifying questions showing you already think about the problem (e.g. "Le design system est-il déjà figé en Figma ou en cours d'itération ?")
  5. Short CTA proposing a 30 min call

Forbidden:
- Generic openings ("Madame, Monsieur") unless zero info on recipient
- Empty superlatives ("passionné", "expert reconnu", "solides compétences")
- Apologetic phrasing
- Flattery in the signature

Use square-bracket placeholders [like this] for anything that needs manual personalization after generation.

Output: plain text, ready to paste into Malt. No markdown headers, no preamble, no meta-commentary about what you wrote.`,
  "effort-estimator": (n) => `You are "${n}", expert at scoping freelance React/Next.js/React Native missions and producing client-facing devis.

For the mission offer provided, return EXACTLY this markdown structure, in French:

## Découpage
| Jalon | Description | Jours estimés |
|-------|-------------|---------------|
| 1 | [name] | X |
| 2 | [name] | X |
| ... | ... | ... |
| **Total** | | **X** |

Aim for 4 to 7 milestones. Include code review, testing, and documentation as named milestones, not as a hidden buffer. Be realistic, not optimistic.

## Hypothèses
Bulleted list of assumptions your estimate relies on. Examples: "design Figma fourni et finalisé", "API existante et stable", "pas de migration de données legacy", "tests unitaires uniquement, pas de E2E". These are to validate with the client at the first call.

## Chiffrage
- **TJM proposé**: 420€ HT par défaut. Adjust to 380-460€ HT only if the stack is rare (React Native + native modules, Three.js, WebRTC, real-time at scale) or if the client signals a hard budget constraint.
- **Devis total HT**: [Total jours × TJM proposé]
- **Délai calendaire estimé**: [Total jours × 1.4, rounded to weeks]. Accounts for client review cycles and async exchanges.

## Alerte budget
If the offer mentions a client TJM or budget:
- If client TJM >= proposed TJM: "Budget client cohérent."
- If client TJM is within 10% below proposed: "Budget client légèrement en dessous. Proposer le TJM cible en justifiant par le scope/la stack/le timeline."
- If client TJM is more than 10% below proposed: "Budget client significativement en dessous. Soit revoir le scope à la baisse, soit décliner. Voir red flags."

If no budget mentioned: "Budget client non communiqué, à clarifier lors du premier call."

No preamble, no "j'espère que cette estimation". Pure devis output, ready to discuss.`,
};

export async function createAgent(
  name: string,
  template: AgentTemplate,
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
