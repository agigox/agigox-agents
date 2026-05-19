import { Bot } from "grammy";
import {
  createAgent,
  assignMission,
  listAgents,
  removeAgent,
} from "./agentManager";
import { AgentTemplate } from "./types";

const TEMPLATES: AgentTemplate[] = ["general", "code-reviewer", "doc-writer"];

function isTemplate(value: string): value is AgentTemplate {
  return (TEMPLATES as string[]).includes(value);
}

export function initTelegramBot(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN not set — bot disabled");
    return;
  }

  const bot = new Bot(token);

  bot.command("start", (ctx) =>
    ctx.reply(
      "Agent Dashboard\n\n/create <name> [template]\n/mission <id> <task>\n/list\n/delete <id>\n\ntemplates: general, code-reviewer, doc-writer",
    ),
  );
  bot.command("create", async (ctx) => {
    const tokens = ctx.match.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return ctx.reply("Usage: /create <name> [template]");
    const last = tokens[tokens.length - 1];
    const template: AgentTemplate = isTemplate(last) ? last : "general";
    const name = isTemplate(last)
      ? tokens.slice(0, -1).join(" ")
      : tokens.join(" ");
    if (!name) return ctx.reply("Usage: /create <name> [template]");
    const agent = await createAgent(name, template);
    ctx.reply(
      `Created\nID: ${agent.id}\nName: ${agent.name}\nTemplate: ${agent.template}`,
    );
  });
  bot.command("mission", async (ctx) => {
    const [agentId, ...rest] = ctx.match.trim().split(" ");
    const mission = rest.join(" ");
    if (!agentId || !mission) return ctx.reply("Usage: /mission <id> <task>");
    await assignMission(agentId, mission);
    ctx.reply(`Mission assigned to ${agentId}`);
  });
  bot.command("list", async (ctx) => {
    const agents = await listAgents();
    if (!agents.length) return ctx.reply("No agents.");
    ctx.reply(
      agents.map((a) => `• [${a.status}] ${a.name}\n  ${a.id}`).join("\n\n"),
    );
  });
  bot.command("delete", async (ctx) => {
    const agentId = ctx.match.trim();
    if (!agentId) return ctx.reply("Usage: /delete <id>");
    await removeAgent(agentId);
    ctx.reply(`Deleted ${agentId}`);
  });

  bot.start();
  console.log("Telegram bot started");
}
